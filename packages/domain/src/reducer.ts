// The community reducer: state = fold(reduce, genesis, log). protocol.md §8–§9.
//
// Rules this file must keep:
// - Pure function of (state, entry): no clocks, randomness, locale or I/O.
// - Every handler validates fully before it mutates anything, so a rejected
//   op changes only bookkeeping (clock, op_ids, rejected_recent).
// - Iteration over records is in sorted-key order.

import { closedTaskDays, DEFAULT_POLICY, parsePolicy } from "./policy.js";
import type {
  Attachment,
  CommunityState,
  ControlHeader,
  DecodedOp,
  Entry,
  Event,
  EventId,
  Location,
  MemberId,
  MemberRecord,
  Outcome,
  Participation,
  ParticipationStatus,
  Profile,
  RejectReason,
  Role,
  Task,
  TaskPriority,
  TaskStatus,
} from "./types.js";
import { clone, isHex, isInt, isObject, isText, isWhatsAppLink, memberIdOf, sortedKeys } from "./util.js";

const DAY_MS = 86_400_000;
const REJECTED_RECENT_MAX = 100;
const MAX_EVENT_ORGANIZERS = 50;

/** Task limits (§9.7). Exported so the app can stop the user before the reducer would. */
export const TASK_LIMITS = {
  title: 200,
  description: 5000,
  tags: 10,
  tag: 30,
  volunteers: 20,
  attachments: 10,
  attachmentName: 120,
  attachmentMime: 100,
  /** Plaintext bytes per attachment; the node caps the ciphertext a little above this. */
  attachmentBytes: 10 * 1024 * 1024,
  comments: 200,
  comment: 2000,
  note: 500,
  history: 50,
} as const;

/** Thrown for a log that cannot start a community. Not a per-op rejection. */
export class GenesisError extends Error {}

/** Thrown when entries are not fed in contiguous seq order. A sync bug, not a rejection. */
export class SequenceError extends Error {}

class Rejection {
  constructor(readonly reason: RejectReason) {}
}

function reject(reason: RejectReason): never {
  throw new Rejection(reason);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Builds the initial state from the genesis entry (seq 1). */
export function genesis(entry: Entry): CommunityState {
  const ctrl = entry.control;
  if (entry.seq !== 1) throw new GenesisError("genesis must be seq 1");
  if (ctrl?.kind !== "genesis") throw new GenesisError("seq 1 must be a genesis control op");
  if (entry.epoch !== 0) throw new GenesisError("genesis must be epoch 0");
  if (ctrl.signer !== ctrl.args.crk) throw new GenesisError("genesis must be signed by the CRK");
  if (ctrl.args.suite !== "VV1") throw new GenesisError("unsupported suite");
  if (!isHex(ctrl.args.crk, 32) || !isHex(ctrl.args.eak, 32) || !isHex(ctrl.args.ik, 32)) {
    throw new GenesisError("malformed genesis keys");
  }
  const admins = normalizeKeySet(ctrl.args.admins);
  if (!admins) throw new GenesisError("malformed genesis admin set");

  const op = entry.op;
  if (!op) throw new GenesisError("genesis body is not readable");
  if (op.type !== "community.init") throw new GenesisError("genesis body must be community.init");
  if (!admins.includes(op.author)) throw new GenesisError("genesis author must be a founding admin");
  const b = op.body;
  if (!isObject(b) || !isText(b.name, 120, 1) || !isText(b.description, 2000)) {
    throw new GenesisError("malformed community.init");
  }
  if (b.region !== undefined && !isText(b.region, 120, 1)) throw new GenesisError("malformed region");
  if (b.whatsapp !== undefined && !isWhatsAppLink(b.whatsapp)) throw new GenesisError("malformed whatsapp");
  const policy = parsePolicy(b.policy ?? DEFAULT_POLICY);
  if (!policy.ok) throw new GenesisError(`genesis policy ${policy.reason}`);

  if (!Array.isArray(b.founders)) throw new GenesisError("missing founders");
  const members: Record<MemberId, MemberRecord> = {};
  for (const f of b.founders) {
    if (!isObject(f) || !isHex(f.msk, 32) || !isHex(f.mek, 32)) throw new GenesisError("malformed founder");
    const profile = parseProfile(f.profile);
    if (!profile) throw new GenesisError("malformed founder profile");
    const id = memberIdOf(f.msk);
    if (members[id]) throw new GenesisError("duplicate founder");
    members[id] = {
      member_id: id,
      msk: f.msk,
      mek: f.mek,
      role: "admin",
      status: "active",
      profile,
      joined_seq: 1,
      key_epoch: 0,
    };
  }
  const founderKeys = Object.values(members).map((m) => m.msk).sort();
  if (founderKeys.join() !== admins.join()) {
    throw new GenesisError("founders must match the genesis admin set");
  }

  const community: CommunityState["community"] = {
    crk: ctrl.args.crk,
    name: b.name,
    description: b.description,
    policy: policy.policy,
  };
  if (b.region !== undefined) community.region = b.region;
  if (b.whatsapp !== undefined) community.whatsapp = b.whatsapp;

  return {
    community,
    epoch: 0,
    eak: ctrl.args.eak,
    admin_set: admins,
    ik: ctrl.args.ik,
    clock: { seq: 1, now: entry.at },
    members,
    events: {},
    event_summaries: {},
    rejected_recent: [],
    op_ids: { [entry.opId]: 1 },
  };
}

/** Pure reducer. Returns a new state; the input is not modified. */
export function reduce(state: CommunityState, entry: Entry): { state: CommunityState; outcome: Outcome } {
  const next = clone(state);
  const outcome = applyInPlace(next, entry);
  return { state: next, outcome };
}

/** Folds a full log starting at genesis. */
export function fold(entries: readonly Entry[]): { state: CommunityState; outcomes: Outcome[] } {
  const [first, ...rest] = entries;
  if (!first) throw new GenesisError("empty log");
  const state = genesis(first);
  const outcomes: Outcome[] = [{ status: "applied" }];
  for (const e of rest) outcomes.push(applyInPlace(state, e));
  return { state, outcomes };
}

/** Folds entries onto an existing state, mutating it. Used after snapshot restore. */
export function applyAll(state: CommunityState, entries: readonly Entry[]): Outcome[] {
  return entries.map((e) => applyInPlace(state, e));
}

/**
 * Mutating reducer step. `state` is modified in place; callers that need
 * persistence of the previous state should use `reduce`.
 */
export function applyInPlace(state: CommunityState, entry: Entry): Outcome {
  if (entry.seq !== state.clock.seq + 1) {
    throw new SequenceError(`expected seq ${state.clock.seq + 1}, got ${entry.seq}`);
  }
  state.clock.seq = entry.seq;
  state.clock.now = Math.max(state.clock.now, entry.at);

  const prior = state.op_ids[entry.opId];
  if (prior !== undefined) {
    sweepRetention(state);
    return { status: "duplicate", seq: prior };
  }
  state.op_ids[entry.opId] = entry.seq;

  let outcome: Outcome;
  try {
    outcome = dispatch(state, entry);
  } catch (err) {
    if (!(err instanceof Rejection)) throw err;
    recordRejection(state, entry, err.reason);
    outcome = { status: "rejected", reason: err.reason };
  }
  sweepRetention(state);
  return outcome;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const CONTROL_INNER_TYPE: Record<ControlHeader["kind"], string> = {
  genesis: "community.init",
  rotate: "epoch.rotate",
  "admin.set": "admin.set",
  migrate: "community.migrate",
  "mod.set": "mod.set",
  disable: "community.disable",
  enable: "community.enable",
};

/** What a disabled community still takes (§11.5), as the node enforces it. */
const ALLOWED_WHILE_DISABLED = new Set<ControlHeader["kind"]>(["enable", "admin.set"]);

/** How long the node keeps a disabled community before deleting it (§11.5). */
export const DISABLED_RETENTION_MS = 30 * DAY_MS;

function dispatch(s: CommunityState, e: Entry): Outcome {
  if (e.control) return applyControl(s, e, e.control);

  // Data plane. Ops under the previous epoch are accepted during the node's
  // grace window (§7.4); anything older or newer is stale.
  if (e.epoch !== s.epoch && e.epoch !== s.epoch - 1) reject("stale_epoch");
  if (s.community.disabled) reject("disabled");
  const op = e.op;
  if (!op) return { status: "opaque" };
  if (Object.values(CONTROL_INNER_TYPE).includes(op.type)) reject("malformed");

  const handler = HANDLERS[op.type];
  if (!handler) reject("unknown_type");
  const author = activeMemberByKey(s, op.author);
  if (!author) reject("not_member");
  handler(s, op, author, e);
  return { status: "applied" };
}

/**
 * Control entries take effect from their cleartext header alone, using exactly
 * the checks the node performs (§5). Anything stricter would let devices and
 * the node disagree on the epoch or admin set. A body that is unreadable or
 * inconsistent with the header is ignored and the outcome is `opaque`.
 */
function applyControl(s: CommunityState, e: Entry, ctrl: ControlHeader): Outcome {
  if (ctrl.kind === "genesis") reject("illegal_transition");
  if (s.community.disabled && !ALLOWED_WHILE_DISABLED.has(ctrl.kind)) reject("disabled");
  applyControlHeader(s, e, ctrl);
  const bodyMatches = e.op?.type === CONTROL_INNER_TYPE[ctrl.kind] && e.op.author === ctrl.signer;
  return bodyMatches ? { status: "applied" } : { status: "opaque" };
}

function applyControlHeader(s: CommunityState, e: Entry, ctrl: ControlHeader): void {
  switch (ctrl.kind) {
    case "genesis":
      reject("illegal_transition");
    // eslint-disable-next-line no-fallthrough
    case "rotate": {
      if (!s.admin_set.includes(ctrl.signer) && !s.mod_set?.includes(ctrl.signer)) reject("not_authorized");
      if (e.epoch !== s.epoch) reject("stale_epoch");
      if (!isInt(ctrl.args.new_epoch) || ctrl.args.new_epoch !== s.epoch + 1) reject("epoch_conflict");
      if (!isHex(ctrl.args.eak, 32)) reject("malformed");
      s.epoch = ctrl.args.new_epoch;
      s.eak = ctrl.args.eak;
      return;
    }
    case "admin.set": {
      if (!s.admin_set.includes(ctrl.signer) && ctrl.signer !== s.community.crk) reject("not_authorized");
      if (e.epoch !== s.epoch) reject("stale_epoch");
      const admins = normalizeKeySet(ctrl.args.admins);
      if (!admins) reject("malformed");
      if (ctrl.args.ik !== undefined && !isHex(ctrl.args.ik, 32)) reject("malformed");
      s.admin_set = admins;
      if (ctrl.args.ik !== undefined) s.ik = ctrl.args.ik;
      return;
    }
    case "migrate": {
      if (!s.admin_set.includes(ctrl.signer) && ctrl.signer !== s.community.crk) reject("not_authorized");
      if (e.epoch !== s.epoch) reject("stale_epoch");
      const nodes = ctrl.args.nodes;
      if (!Array.isArray(nodes) || nodes.length > 5 || !nodes.every(isNodeUrl)) reject("malformed");
      if (nodes.length > 0) s.community.nodes = [...nodes];
      else delete s.community.nodes;
      return;
    }
    case "disable": {
      if (!s.admin_set.includes(ctrl.signer)) reject("not_authorized");
      if (e.epoch !== s.epoch) reject("stale_epoch");
      s.community.disabled = { by: ctrl.signer, at: e.at };
      return;
    }
    case "enable": {
      const d = s.community.disabled;
      if (!d) reject("illegal_transition");
      if (!s.admin_set.includes(ctrl.signer) || ctrl.signer === d.by) reject("not_authorized");
      if (e.epoch !== s.epoch) reject("stale_epoch");
      delete s.community.disabled;
      return;
    }
    case "mod.set": {
      if (!s.admin_set.includes(ctrl.signer) && ctrl.signer !== s.community.crk) reject("not_authorized");
      if (e.epoch !== s.epoch) reject("stale_epoch");
      const mods = Array.isArray(ctrl.args.moderators) && ctrl.args.moderators.length === 0 ? [] : normalizeKeySet(ctrl.args.moderators);
      if (!mods) reject("malformed");
      if (mods.length > 0) s.mod_set = mods;
      else delete s.mod_set;
      return;
    }
  }
}

/** Same rule as the wire decoder (§5): http(s), printable ASCII, ≤ 200 chars. */
function isNodeUrl(u: unknown): boolean {
  return typeof u === "string" && u.length <= 200 && /^https?:\/\/[\x21-\x7e]+$/.test(u);
}

type Handler = (s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry) => void;

const HANDLERS: Record<string, Handler> = {
  "community.update": communityUpdate,
  "policy.update": policyUpdate,
  "member.add": memberAdd,
  "member.remove": memberRemove,
  "member.block": memberBlock,
  "member.unblock": memberUnblock,
  "member.leave": memberLeave,
  "member.role": memberRole,
  "member.profile": memberProfile,
  "event.create": eventCreate,
  "event.update": eventUpdate,
  "event.cancel": eventClose("cancelled"),
  "event.complete": eventClose("completed"),
  "event.attendance": eventAttendance,
  "event.remove": eventRemove,
  "participation.invite": participation("invite"),
  "participation.volunteer": participation("volunteer"),
  "participation.accept": participation("accept"),
  "participation.decline": participation("decline"),
  "participation.revoke": participation("revoke"),
  "participation.approve": participation("approve"),
  "participation.reject": participation("reject"),
  "participation.withdraw": participation("withdraw"),
  "task.create": taskCreate,
  "task.update": taskUpdate,
  "task.assign": taskAssign,
  "task.unassign": taskUnassign,
  "task.join": taskJoin,
  "task.leave": taskLeave,
  "task.status": taskStatus,
  "task.comment": taskComment,
  "task.comment_edit": taskCommentEdit,
  "task.comment_delete": taskCommentDelete,
  "task.remove": taskRemove,
};

export const DATA_OP_TYPES: readonly string[] = Object.keys(HANDLERS);

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

function activeMemberByKey(s: CommunityState, msk: string): MemberRecord | undefined {
  if (!isHex(msk, 32)) return undefined;
  const m = s.members[memberIdOf(msk)];
  return m?.status === "active" ? m : undefined;
}

/**
 * Admin power comes from the control-plane admin set alone (§9.2): the set
 * the node enforces and the CRK can reset. The data-plane role "admin" is a
 * label; on its own it grants organizer rights. This keeps CRK recovery from
 * deadlocking when every admin device is lost.
 */
export function isAdmin(s: CommunityState, m: MemberRecord): boolean {
  return m.status === "active" && s.admin_set.includes(m.msk);
}

/**
 * Moderators (§9.2) come from the control-plane moderator set, which the
 * node also enforces: they accept join requests, block and unblock, read
 * reports and may rotate the epoch key.
 */
export function isModerator(s: CommunityState, m: MemberRecord): boolean {
  return m.status === "active" && !!s.mod_set?.includes(m.msk);
}

/** Admins and moderators: who may let people in and keep people out. */
export function canModerate(s: CommunityState, m: MemberRecord): boolean {
  return isAdmin(s, m) || isModerator(s, m);
}

export function isOrganizer(s: CommunityState, m: MemberRecord): boolean {
  return m.status === "active" && (m.role === "organizer" || m.role === "admin" || s.admin_set.includes(m.msk));
}

function activeAdminCount(s: CommunityState): number {
  let n = 0;
  for (const id of sortedKeys(s.members)) if (isAdmin(s, s.members[id]!)) n++;
  return n;
}

function requireAdmin(s: CommunityState, m: MemberRecord): void {
  if (!isAdmin(s, m)) reject("not_authorized");
}

function requireModerator(s: CommunityState, m: MemberRecord): void {
  if (!canModerate(s, m)) reject("not_authorized");
}

function requireOrganizer(s: CommunityState, m: MemberRecord): void {
  if (!isOrganizer(s, m)) reject("not_authorized");
}

function canManageEvent(s: CommunityState, m: MemberRecord, ev: Event): boolean {
  return isAdmin(s, m) || (isOrganizer(s, m) && ev.organizers.includes(m.member_id));
}

// ---------------------------------------------------------------------------
// Community and policy
// ---------------------------------------------------------------------------

function communityUpdate(s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  requireAdmin(s, author);
  const b = body(op);
  if (b.name !== undefined && !isText(b.name, 120, 1)) reject("malformed");
  if (b.description !== undefined && !isText(b.description, 2000)) reject("malformed");
  if (b.region !== undefined && !isText(b.region, 120, 1)) reject("malformed");
  if (b.whatsapp !== undefined && b.whatsapp !== null && !isWhatsAppLink(b.whatsapp)) reject("malformed");
  if (b.name !== undefined) s.community.name = b.name;
  if (b.description !== undefined) s.community.description = b.description;
  if (b.region !== undefined) s.community.region = b.region;
  if (b.whatsapp === null) delete s.community.whatsapp;
  else if (b.whatsapp !== undefined) s.community.whatsapp = b.whatsapp;
}

function policyUpdate(s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  requireAdmin(s, author);
  const parsed = parsePolicy(body(op).policy);
  if (!parsed.ok) reject(parsed.reason);
  s.community.policy = parsed.policy;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

function memberAdd(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  requireModerator(s, author);
  const b = body(op);
  if (!isHex(b.msk, 32) || !isHex(b.mek, 32)) reject("malformed");
  const profile = parseProfile(b.profile);
  if (!profile) reject("malformed");
  const role = b.role ?? "member";
  if (role !== "member" && role !== "organizer") {
    // Admins are made via member.role + admin.set, never directly (§9.2).
    reject(role === "admin" ? "illegal_transition" : "malformed");
  }
  const id = memberIdOf(b.msk);
  if (s.members[id]?.status === "active") reject("already_exists");
  if (s.members[id]?.blocked) reject("not_authorized");
  s.members[id] = {
    member_id: id,
    msk: b.msk,
    mek: b.mek,
    role,
    status: "active",
    profile,
    joined_seq: e.seq,
    key_epoch: s.epoch,
  };
}

function memberRemove(s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  const b = body(op);
  if (!isHex(b.member_id, 32)) reject("malformed");
  if (b.reason !== undefined && !isText(b.reason, 500)) reject("malformed");
  const target = s.members[b.member_id];
  if (target?.status !== "active") reject("unknown_target");
  if (isAdmin(s, author)) {
    // any target
  } else if (isOrganizer(s, author) && target.role === "member") {
    // organizers may remove plain members only
  } else {
    reject("not_authorized");
  }
  if (isAdmin(s, target) && activeAdminCount(s) <= 1) reject("last_admin");
  endMembership(s, target, "removed");
}

/**
 * Blocks a member: removes them if still active and bars `member.add` for
 * their key until `member.unblock`. Admins block anyone; moderators block
 * anyone but admins and moderators. Former members can be blocked too, so
 * someone who left cannot simply be let back in.
 */
function memberBlock(s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  requireModerator(s, author);
  const b = body(op);
  if (!isHex(b.member_id, 32)) reject("malformed");
  if (b.reason !== undefined && !isText(b.reason, 500)) reject("malformed");
  const target = s.members[b.member_id];
  if (!target) reject("unknown_target");
  if (target.blocked) reject("illegal_transition");
  if (target.member_id === author.member_id) reject("illegal_transition");
  if (!isAdmin(s, author) && canModerate(s, target)) reject("not_authorized");
  if (isAdmin(s, target) && activeAdminCount(s) <= 1) reject("last_admin");
  if (target.status === "active") endMembership(s, target, "removed");
  target.blocked = true;
}

function memberUnblock(s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  requireModerator(s, author);
  const b = body(op);
  if (!isHex(b.member_id, 32)) reject("malformed");
  const target = s.members[b.member_id];
  if (!target) reject("unknown_target");
  if (!target.blocked) reject("illegal_transition");
  delete target.blocked;
}

function memberLeave(s: CommunityState, _op: DecodedOp, author: MemberRecord): void {
  if (isAdmin(s, author) && activeAdminCount(s) <= 1) reject("last_admin");
  endMembership(s, author, "left");
}

function endMembership(s: CommunityState, m: MemberRecord, status: "removed" | "left"): void {
  m.status = status;
  m.ended_at = s.clock.now;
  // A member who is gone cannot attend: withdraw open participations and drop
  // them from organizer lists of events still being planned.
  for (const evId of sortedKeys(s.events)) {
    const ev = s.events[evId]!;
    if (ev.status !== "scheduled") continue;
    const p = ev.participations[m.member_id];
    if (p && OPEN_STATUSES.has(p.status)) {
      ev.participations[m.member_id] = { status: "withdrawn", updated_seq: s.clock.seq };
    }
    ev.organizers = ev.organizers.filter((id) => id !== m.member_id);
  }
  // Open tasks lose them too: the task goes back to the volunteer pool.
  for (const id of sortedKeys(s.tasks ?? {})) {
    const task = s.tasks![id]!;
    if (!isOpenTask(task)) continue;
    dropFromTask(s, task, m.member_id);
  }
}

function memberRole(s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  requireAdmin(s, author);
  const b = body(op);
  if (!isHex(b.member_id, 32) || !isRole(b.role)) reject("malformed");
  const target = s.members[b.member_id];
  if (target?.status !== "active") reject("unknown_target");
  if (b.role !== "admin" && isAdmin(s, target) && activeAdminCount(s) <= 1) reject("last_admin");
  target.role = b.role;
}

function memberProfile(_s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  const profile = parseProfile(body(op).profile);
  if (!profile) reject("malformed");
  author.profile = profile;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function eventCreate(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  requireOrganizer(s, author);
  const b = body(op);
  if (!isHex(b.event_id, 16)) reject("malformed");
  if (s.events[b.event_id] || s.event_summaries[b.event_id]) reject("already_exists");
  const f = parseEventFields(b, true);
  const organizers = f.organizers ?? [author.member_id];
  requireEventOrganizers(s, organizers);
  const ev: Event = {
    event_id: b.event_id,
    title: f.title!,
    description: f.description ?? "",
    starts_at: f.starts_at!,
    ends_at: f.ends_at!,
    tz: f.tz!,
    location: f.location!,
    organizers,
    status: "scheduled",
    created_seq: e.seq,
    participations: {},
  };
  if (f.capacity !== undefined) ev.capacity = f.capacity;
  if (f.whatsapp !== undefined) ev.whatsapp = f.whatsapp;
  if (ev.starts_at >= ev.ends_at) reject("malformed");
  s.events[ev.event_id] = ev;
}

function eventUpdate(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  const ev = scheduledEvent(s, b.event_id);
  if (!canManageEvent(s, author, ev)) reject("not_authorized");
  const f = parseEventFields(b, false);
  if (f.organizers) requireEventOrganizers(s, f.organizers);
  const startsAt = f.starts_at ?? ev.starts_at;
  const endsAt = f.ends_at ?? ev.ends_at;
  if (startsAt >= endsAt) reject("malformed");

  const area = f.location?.area;
  const whenOrWhereChanged =
    startsAt !== ev.starts_at ||
    endsAt !== ev.ends_at ||
    (area !== undefined && (area.lat_e4 !== ev.location.area.lat_e4 || area.lng_e4 !== ev.location.area.lng_e4));

  if (f.title !== undefined) ev.title = f.title;
  if (f.description !== undefined) ev.description = f.description;
  if (f.tz !== undefined) ev.tz = f.tz;
  if (f.location !== undefined) ev.location = f.location;
  if (f.organizers !== undefined) ev.organizers = f.organizers;
  if (f.capacity !== undefined) ev.capacity = f.capacity;
  if (b.capacity === null) delete ev.capacity;
  if (f.whatsapp !== undefined) ev.whatsapp = f.whatsapp;
  if (b.whatsapp === null) delete ev.whatsapp;
  ev.starts_at = startsAt;
  ev.ends_at = endsAt;

  // Availability was computed against the old time/place (§9.3).
  if (whenOrWhereChanged) {
    for (const id of sortedKeys(ev.participations)) {
      const p = ev.participations[id]!;
      if (p.status === "confirmed") ev.participations[id] = { status: "reconfirm", updated_seq: e.seq };
    }
  }
}

function eventClose(status: "cancelled" | "completed"): Handler {
  return (s, op, author) => {
    const b = body(op);
    if (b.reason !== undefined && !isText(b.reason, 500)) reject("malformed");
    const ev = scheduledEvent(s, b.event_id);
    if (!canManageEvent(s, author, ev)) reject("not_authorized");
    ev.status = status;
    ev.closed_at = s.clock.now;
  };
}

function eventAttendance(s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  const b = body(op);
  if (!isHex(b.event_id, 16) || !Array.isArray(b.attended)) reject("malformed");
  const ev = s.events[b.event_id];
  if (!ev) reject("unknown_target");
  if (!canManageEvent(s, author, ev)) reject("not_authorized");
  if (ev.status !== "completed") reject("illegal_transition");
  const attended = new Set<MemberId>();
  for (const id of b.attended) {
    if (!isHex(id, 32)) reject("malformed");
    if (ev.participations[id]?.status !== "confirmed") reject("illegal_transition");
    attended.add(id);
  }
  ev.attended = [...attended].sort();
}

/**
 * Moderation: deletes an event outright, whatever its status, for content
 * that should not stay up. Unlike `event.cancel`, nothing remains: no
 * details, no participations, no summary. Admins and moderators only.
 */
function eventRemove(s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  requireModerator(s, author);
  const b = body(op);
  if (!isHex(b.event_id, 16)) reject("malformed");
  if (b.reason !== undefined && !isText(b.reason, 500)) reject("malformed");
  if (!s.events[b.event_id] && !s.event_summaries[b.event_id]) reject("unknown_target");
  delete s.events[b.event_id];
  delete s.event_summaries[b.event_id];
  // Its tasks go with it; the remover's device drops their blobs (§9.7).
  for (const id of sortedKeys(s.tasks ?? {})) {
    if (s.tasks![id]!.event_id === b.event_id) delete s.tasks![id];
  }
  pruneTasks(s);
}

function scheduledEvent(s: CommunityState, eventId: unknown): Event {
  if (!isHex(eventId, 16)) reject("malformed");
  const ev = s.events[eventId];
  if (!ev) reject("unknown_target");
  if (ev.status !== "scheduled") reject("illegal_transition");
  return ev;
}

function requireEventOrganizers(s: CommunityState, ids: MemberId[]): void {
  for (const id of ids) {
    const m = s.members[id];
    if (!m || !isOrganizer(s, m)) reject("unknown_target");
  }
}

interface EventFields {
  title?: string;
  description?: string;
  starts_at?: number;
  ends_at?: number;
  tz?: string;
  location?: Location;
  capacity?: number;
  whatsapp?: string;
  organizers?: MemberId[];
}

function parseEventFields(b: Record<string, unknown>, create: boolean): EventFields {
  const f: EventFields = {};
  const need = (k: string) => create && b[k] === undefined && reject("malformed");
  need("title");
  need("starts_at");
  need("ends_at");
  need("tz");
  need("location");

  if (b.title !== undefined) f.title = isText(b.title, 200, 1) ? b.title : reject("malformed");
  if (b.description !== undefined) {
    f.description = isText(b.description, 5000) ? b.description : reject("malformed");
  }
  if (b.starts_at !== undefined) f.starts_at = isInt(b.starts_at) ? b.starts_at : reject("malformed");
  if (b.ends_at !== undefined) f.ends_at = isInt(b.ends_at) ? b.ends_at : reject("malformed");
  if (b.tz !== undefined) f.tz = isText(b.tz, 64, 1) ? b.tz : reject("malformed");
  if (b.location !== undefined) f.location = parseLocation(b.location) ?? reject("malformed");
  if (b.capacity !== undefined && b.capacity !== null) {
    f.capacity = isInt(b.capacity, 1, 1_000_000) ? b.capacity : reject("malformed");
  }
  if (b.whatsapp !== undefined && b.whatsapp !== null) {
    f.whatsapp = isWhatsAppLink(b.whatsapp) ? b.whatsapp : reject("malformed");
  }
  if (b.organizers !== undefined) {
    if (!Array.isArray(b.organizers) || b.organizers.length === 0) reject("malformed");
    if (b.organizers.length > MAX_EVENT_ORGANIZERS) reject("malformed");
    if (!b.organizers.every((id) => isHex(id, 32))) reject("malformed");
    f.organizers = [...new Set(b.organizers as MemberId[])].sort();
  }
  return f;
}

function parseLocation(v: unknown): Location | undefined {
  if (!isObject(v) || !isText(v.label, 200, 1) || !isObject(v.area)) return undefined;
  const { lat_e4, lng_e4 } = v.area;
  if (!isInt(lat_e4, -900_000, 900_000) || !isInt(lng_e4, -1_800_000, 1_800_000)) return undefined;
  const loc: Location = { label: v.label, area: { lat_e4, lng_e4 } };
  if (v.radius_m !== undefined) {
    if (!isInt(v.radius_m, 1, 100_000)) return undefined;
    loc.radius_m = v.radius_m;
  }
  return loc;
}

// ---------------------------------------------------------------------------
// Participation (§9.4)
// ---------------------------------------------------------------------------

type ParticipationAction =
  | "invite"
  | "volunteer"
  | "accept"
  | "decline"
  | "revoke"
  | "approve"
  | "reject"
  | "withdraw";

type From = ParticipationStatus | "none";

const SELF_ACTIONS = new Set<ParticipationAction>(["volunteer", "accept", "decline", "withdraw"]);

const TRANSITIONS: Record<ParticipationAction, Partial<Record<From, ParticipationStatus>>> = {
  invite: { none: "invited", declined: "invited", withdrawn: "invited", not_selected: "invited", revoked: "invited" },
  volunteer: { none: "volunteered", withdrawn: "volunteered", declined: "volunteered" },
  accept: { invited: "confirmed", reconfirm: "confirmed" },
  decline: { invited: "declined", reconfirm: "withdrawn" },
  revoke: { invited: "revoked" },
  approve: { volunteered: "confirmed" },
  reject: { volunteered: "not_selected" },
  withdraw: { volunteered: "withdrawn", confirmed: "withdrawn", reconfirm: "withdrawn" },
};

/** Statuses that still hold or claim a place at the event. */
const OPEN_STATUSES = new Set<ParticipationStatus>(["invited", "volunteered", "confirmed", "reconfirm"]);

function participation(action: ParticipationAction): Handler {
  return (s, op, author, e) => {
    const b = body(op);
    if (b.note !== undefined && !isText(b.note, 500)) reject("malformed");
    const ev = scheduledEvent(s, b.event_id);

    let targetId: MemberId;
    if (SELF_ACTIONS.has(action)) {
      if (b.member_id !== undefined && b.member_id !== author.member_id) reject("not_authorized");
      targetId = author.member_id;
    } else {
      requireOrganizer(s, author);
      if (!isHex(b.member_id, 32)) reject("malformed");
      targetId = b.member_id;
      if (s.members[targetId]?.status !== "active") reject("unknown_target");
    }

    const from: From = ev.participations[targetId]?.status ?? "none";
    let to = TRANSITIONS[action][from];
    if (!to) reject("illegal_transition");
    if (action === "volunteer" && s.community.policy.volunteer_mode === "auto") to = "confirmed";
    if (to === "confirmed" && ev.capacity !== undefined && confirmedCount(ev) >= ev.capacity) {
      reject("capacity_full");
    }
    const p: Participation = { status: to, updated_seq: e.seq };
    ev.participations[targetId] = p;
  };
}

function confirmedCount(ev: Event): number {
  let n = 0;
  for (const id of sortedKeys(ev.participations)) if (ev.participations[id]!.status === "confirmed") n++;
  return n;
}

// ---------------------------------------------------------------------------
// Tasks (§9.7)
// ---------------------------------------------------------------------------

const TASK_STATUSES: readonly TaskStatus[] = ["awaiting_volunteer", "todo", "in_progress", "blocked", "done", "cancelled"];
const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "normal", "high", "urgent"];
/** Statuses that mean "someone is on it": they require an assignee. */
const ASSIGNED_STATUSES = new Set<TaskStatus>(["todo", "in_progress", "blocked"]);
const CLOSED_STATUSES = new Set<TaskStatus>(["done", "cancelled"]);

function isOpenTask(task: Task): boolean {
  return !CLOSED_STATUSES.has(task.status);
}

/**
 * Who runs a task: admins and moderators everywhere; for a task inside an
 * event, that event's organizers too. Community-level tasks belong to the
 * coordination team alone.
 */
export function canManageTask(s: CommunityState, m: MemberRecord, task: Task): boolean {
  if (canModerate(s, m)) return true;
  if (task.event_id === undefined) return false;
  const ev = s.events[task.event_id];
  return ev !== undefined && canManageEvent(s, m, ev);
}

/** Assignee or helper: the people doing the work. */
export function isOnTask(m: MemberRecord, task: Task): boolean {
  return task.assignee === m.member_id || task.volunteers.includes(m.member_id);
}

/**
 * Who may read and discuss a task: its managers, the people on it, and, for
 * a task inside an event, everyone taking part in that event. Any member
 * may see a task waiting for a volunteer; that is the point of the pool.
 */
export function canSeeTask(s: CommunityState, m: MemberRecord, task: Task): boolean {
  if (m.status !== "active") return false;
  if (task.status === "awaiting_volunteer") return true;
  if (canManageTask(s, m, task) || isOnTask(m, task)) return true;
  if (task.event_id === undefined) return false;
  const p = s.events[task.event_id]?.participations[m.member_id];
  return p?.status === "confirmed" || p?.status === "reconfirm";
}

function requireTaskManager(s: CommunityState, m: MemberRecord, task: Task): void {
  if (!canManageTask(s, m, task)) reject("not_authorized");
}

function liveTask(s: CommunityState, taskId: unknown): Task {
  if (!isHex(taskId, 16)) reject("malformed");
  const task = s.tasks?.[taskId];
  if (!task) reject("unknown_target");
  return task;
}

function openTask(s: CommunityState, taskId: unknown): Task {
  const task = liveTask(s, taskId);
  if (!isOpenTask(task)) reject("illegal_transition");
  return task;
}

/** Drops the `tasks` map when empty so untouched communities hash as before. */
function pruneTasks(s: CommunityState): void {
  if (s.tasks && Object.keys(s.tasks).length === 0) delete s.tasks;
}

function touchTask(task: Task, seq: number): void {
  task.updated_seq = seq;
}

function setTaskStatus(s: CommunityState, task: Task, status: TaskStatus, by: MemberId, seq: number, note?: string): void {
  task.status = status;
  if (CLOSED_STATUSES.has(status)) task.closed_at = s.clock.now;
  else delete task.closed_at;
  const change: Task["history"][number] = { status, by, seq };
  if (note !== undefined) change.note = note;
  task.history.push(change);
  if (task.history.length > TASK_LIMITS.history) task.history.shift();
  touchTask(task, seq);
}

/** Removes a member from an open task; without an assignee it waits for a volunteer again. */
function dropFromTask(s: CommunityState, task: Task, memberId: MemberId): void {
  const seq = s.clock.seq;
  if (task.volunteers.includes(memberId)) {
    task.volunteers = task.volunteers.filter((id) => id !== memberId);
    touchTask(task, seq);
  }
  if (task.assignee === memberId) {
    delete task.assignee;
    if (task.status !== "awaiting_volunteer") setTaskStatus(s, task, "awaiting_volunteer", memberId, seq);
    else touchTask(task, seq);
  }
}

interface TaskFields {
  title?: string;
  description?: string;
  tags?: string[];
  priority?: TaskPriority;
  due_at?: number;
  attachments?: Attachment[];
}

function parseTaskFields(b: Record<string, unknown>, create: boolean): TaskFields {
  const f: TaskFields = {};
  if (create && b.title === undefined) reject("malformed");
  if (b.title !== undefined) f.title = isText(b.title, TASK_LIMITS.title, 1) ? b.title : reject("malformed");
  if (b.description !== undefined) {
    f.description = isText(b.description, TASK_LIMITS.description) ? b.description : reject("malformed");
  }
  if (b.tags !== undefined) f.tags = parseTags(b.tags) ?? reject("malformed");
  if (b.priority !== undefined) {
    f.priority = TASK_PRIORITIES.includes(b.priority as TaskPriority) ? (b.priority as TaskPriority) : reject("malformed");
  }
  if (b.due_at !== undefined && b.due_at !== null) f.due_at = isInt(b.due_at) ? b.due_at : reject("malformed");
  if (b.attachments !== undefined) f.attachments = parseAttachments(b.attachments) ?? reject("malformed");
  return f;
}

/** Tags are free text: trimmed, lowercased, unique, sorted. Empty after trimming is malformed. */
function parseTags(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > TASK_LIMITS.tags) return undefined;
  const out = new Set<string>();
  for (const t of v) {
    if (!isText(t, TASK_LIMITS.tag, 1)) return undefined;
    const norm = t.trim().toLowerCase();
    if (norm.length === 0 || norm.includes("\n")) return undefined;
    out.add(norm);
  }
  return [...out].sort();
}

function parseAttachments(v: unknown): Attachment[] | undefined {
  if (!Array.isArray(v) || v.length > TASK_LIMITS.attachments) return undefined;
  const out: Attachment[] = [];
  const seen = new Set<string>();
  for (const a of v) {
    if (
      !isObject(a) ||
      !isHex(a.blob_id, 32) ||
      !isHex(a.key, 32) ||
      !isHex(a.nonce, 24) ||
      !isText(a.name, TASK_LIMITS.attachmentName, 1) ||
      !isText(a.mime, TASK_LIMITS.attachmentMime, 1) ||
      !isInt(a.size, 0, TASK_LIMITS.attachmentBytes)
    ) {
      return undefined;
    }
    if (seen.has(a.blob_id)) return undefined;
    seen.add(a.blob_id);
    out.push({ blob_id: a.blob_id, key: a.key, nonce: a.nonce, name: a.name, mime: a.mime, size: a.size });
  }
  return out;
}

function parseMemberList(v: unknown, max: number): MemberId[] | undefined {
  if (!Array.isArray(v) || v.length > max || !v.every((id) => isHex(id, 32))) return undefined;
  return [...new Set(v as MemberId[])].sort();
}

function requireActiveMembers(s: CommunityState, ids: MemberId[]): void {
  for (const id of ids) if (s.members[id]?.status !== "active") reject("unknown_target");
}

/** The scope a new or moved task lands in; the author must manage it. */
function requireScopeManager(s: CommunityState, author: MemberRecord, eventId: EventId | undefined): void {
  if (canModerate(s, author)) return;
  if (eventId === undefined) reject("not_authorized");
  const ev = s.events[eventId];
  if (!ev) reject(s.event_summaries[eventId] ? "not_authorized" : "unknown_target");
  if (!canManageEvent(s, author, ev)) reject("not_authorized");
}

function taskCreate(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  if (!isHex(b.task_id, 16)) reject("malformed");
  if (b.event_id !== undefined && !isHex(b.event_id, 16)) reject("malformed");
  const eventId = b.event_id as EventId | undefined;
  if (eventId !== undefined && !s.events[eventId] && !s.event_summaries[eventId]) reject("unknown_target");
  if (s.tasks?.[b.task_id]) reject("already_exists");
  const f = parseTaskFields(b, true);
  if (b.assignee !== undefined && !isHex(b.assignee, 32)) reject("malformed");
  const volunteers = b.volunteers === undefined ? [] : (parseMemberList(b.volunteers, TASK_LIMITS.volunteers) ?? reject("malformed"));
  const assignee = b.assignee as MemberId | undefined;
  if (assignee !== undefined && volunteers.includes(assignee)) reject("malformed");
  requireScopeManager(s, author, eventId);
  requireActiveMembers(s, assignee === undefined ? volunteers : [assignee, ...volunteers]);

  const status: TaskStatus = assignee === undefined ? "awaiting_volunteer" : "todo";
  const task: Task = {
    task_id: b.task_id,
    title: f.title!,
    description: f.description ?? "",
    tags: f.tags ?? [],
    status,
    priority: f.priority ?? "normal",
    volunteers,
    attachments: f.attachments ?? [],
    comments: [],
    history: [{ status, by: author.member_id, seq: e.seq }],
    created_by: author.member_id,
    created_seq: e.seq,
    updated_seq: e.seq,
  };
  if (eventId !== undefined) task.event_id = eventId;
  if (f.due_at !== undefined) task.due_at = f.due_at;
  if (assignee !== undefined) task.assignee = assignee;
  (s.tasks ??= {})[task.task_id] = task;
}

/** Fields, tags, priority, due date and attachments: the manager or the assignee. */
function taskUpdate(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  const task = openTask(s, b.task_id);
  const f = parseTaskFields(b, false);
  if (b.event_id !== undefined && b.event_id !== null && !isHex(b.event_id, 16)) reject("malformed");
  const movesScope = b.event_id !== undefined && (b.event_id ?? undefined) !== task.event_id;
  if (movesScope) {
    // Moving a task between scopes needs authority over both.
    requireTaskManager(s, author, task);
    const to = (b.event_id ?? undefined) as EventId | undefined;
    if (to !== undefined && !s.events[to] && !s.event_summaries[to]) reject("unknown_target");
    requireScopeManager(s, author, to);
  } else if (!canManageTask(s, author, task) && task.assignee !== author.member_id) {
    reject("not_authorized");
  }
  if (f.title !== undefined) task.title = f.title;
  if (f.description !== undefined) task.description = f.description;
  if (f.tags !== undefined) task.tags = f.tags;
  if (f.priority !== undefined) task.priority = f.priority;
  if (f.due_at !== undefined) task.due_at = f.due_at;
  if (b.due_at === null) delete task.due_at;
  if (f.attachments !== undefined) task.attachments = f.attachments;
  if (movesScope) {
    if (b.event_id === null) delete task.event_id;
    else task.event_id = b.event_id as EventId;
  }
  touchTask(task, e.seq);
}

/**
 * Managers assign anyone (replacing the current assignee); any member may
 * take a task that has no assignee. The task moves from the pool to `todo`.
 */
function taskAssign(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  const task = openTask(s, b.task_id);
  const target: MemberId = b.member_id === undefined ? author.member_id : isHex(b.member_id, 32) ? b.member_id : reject("malformed");
  if (target === author.member_id) {
    if (task.assignee !== undefined && task.assignee !== target && !canManageTask(s, author, task)) reject("not_authorized");
  } else {
    requireTaskManager(s, author, task);
  }
  if (s.members[target]?.status !== "active") reject("unknown_target");
  if (task.assignee === target) reject("illegal_transition");
  task.assignee = target;
  task.volunteers = task.volunteers.filter((id) => id !== target);
  if (task.status === "awaiting_volunteer") setTaskStatus(s, task, "todo", author.member_id, e.seq);
  else touchTask(task, e.seq);
}

/** The assignee steps down, or a manager clears the assignee: back to the pool. */
function taskUnassign(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  const task = openTask(s, b.task_id);
  if (task.assignee === undefined) reject("illegal_transition");
  if (task.assignee !== author.member_id) requireTaskManager(s, author, task);
  delete task.assignee;
  setTaskStatus(s, task, "awaiting_volunteer", author.member_id, e.seq);
}

/** Joins as a helper: oneself on any open task, or a manager adding someone. */
function taskJoin(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  const task = openTask(s, b.task_id);
  const target: MemberId = b.member_id === undefined ? author.member_id : isHex(b.member_id, 32) ? b.member_id : reject("malformed");
  if (target !== author.member_id) requireTaskManager(s, author, task);
  if (s.members[target]?.status !== "active") reject("unknown_target");
  if (task.assignee === target || task.volunteers.includes(target)) reject("illegal_transition");
  if (task.volunteers.length >= TASK_LIMITS.volunteers) reject("capacity_full");
  task.volunteers = [...task.volunteers, target].sort();
  touchTask(task, e.seq);
}

function taskLeave(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  const task = openTask(s, b.task_id);
  const target: MemberId = b.member_id === undefined ? author.member_id : isHex(b.member_id, 32) ? b.member_id : reject("malformed");
  if (target !== author.member_id) requireTaskManager(s, author, task);
  if (!task.volunteers.includes(target)) reject("illegal_transition");
  task.volunteers = task.volunteers.filter((id) => id !== target);
  touchTask(task, e.seq);
}

/**
 * Status changes. The people on the task move it between `todo`,
 * `in_progress`, `blocked` and `done`; managers also cancel, mark a task
 * from the pool as done, and reopen. A reopened task returns to `todo` if
 * it still has an assignee, otherwise to the pool; a task with no assignee
 * cannot be "in progress".
 */
function taskStatus(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  if (!TASK_STATUSES.includes(b.status as TaskStatus)) reject("malformed");
  if (b.note !== undefined && !isText(b.note, TASK_LIMITS.note)) reject("malformed");
  const to = b.status as TaskStatus;
  const task = liveTask(s, b.task_id);
  const from = task.status;
  const manager = canManageTask(s, author, task);
  if (to === from) reject("illegal_transition");

  if (CLOSED_STATUSES.has(from)) {
    // Reopen (managers only), to the status the assignee situation implies.
    if (!manager) reject("not_authorized");
    const expected: TaskStatus = task.assignee === undefined ? "awaiting_volunteer" : "todo";
    if (to !== expected) reject("illegal_transition");
  } else if (to === "cancelled") {
    if (!manager) reject("not_authorized");
  } else if (to === "awaiting_volunteer") {
    // Only `task.unassign` (or losing the assignee) sends a task back to the pool.
    reject("illegal_transition");
  } else if (ASSIGNED_STATUSES.has(to)) {
    if (task.assignee === undefined) reject("illegal_transition");
    if (!manager && !isOnTask(author, task)) reject("not_authorized");
  } else {
    // done
    if (from === "awaiting_volunteer" ? !manager : !manager && !isOnTask(author, task)) reject("not_authorized");
  }
  setTaskStatus(s, task, to, author.member_id, e.seq, b.note as string | undefined);
}

function taskComment(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  if (!isHex(b.comment_id, 16) || !isText(b.body, TASK_LIMITS.comment, 1)) reject("malformed");
  const task = liveTask(s, b.task_id);
  if (!canSeeTask(s, author, task)) reject("not_authorized");
  if (task.comments.some((c) => c.comment_id === b.comment_id)) reject("already_exists");
  if (task.comments.length >= TASK_LIMITS.comments) reject("capacity_full");
  task.comments.push({ comment_id: b.comment_id, author: author.member_id, body: b.body, seq: e.seq });
  touchTask(task, e.seq);
}

function taskCommentEdit(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  if (!isHex(b.comment_id, 16) || !isText(b.body, TASK_LIMITS.comment, 1)) reject("malformed");
  const task = liveTask(s, b.task_id);
  const c = task.comments.find((x) => x.comment_id === b.comment_id);
  if (!c) reject("unknown_target");
  if (c.author !== author.member_id) reject("not_authorized");
  c.body = b.body;
  c.edited_seq = e.seq;
  touchTask(task, e.seq);
}

/** The author, or whoever manages the task (moderation). */
function taskCommentDelete(s: CommunityState, op: DecodedOp, author: MemberRecord, e: Entry): void {
  const b = body(op);
  if (!isHex(b.comment_id, 16)) reject("malformed");
  const task = liveTask(s, b.task_id);
  const c = task.comments.find((x) => x.comment_id === b.comment_id);
  if (!c) reject("unknown_target");
  if (c.author !== author.member_id) requireTaskManager(s, author, task);
  task.comments = task.comments.filter((x) => x.comment_id !== b.comment_id);
  touchTask(task, e.seq);
}

/** Deletes a task outright, whatever its status. The remover's device drops its blobs. */
function taskRemove(s: CommunityState, op: DecodedOp, author: MemberRecord): void {
  const b = body(op);
  if (b.reason !== undefined && !isText(b.reason, 500)) reject("malformed");
  const task = liveTask(s, b.task_id);
  requireTaskManager(s, author, task);
  delete s.tasks![task.task_id];
  pruneTasks(s);
}

// ---------------------------------------------------------------------------
// Retention (§12.2): runs after every entry, driven by the node-time clock.
// ---------------------------------------------------------------------------

function sweepRetention(s: CommunityState): void {
  const r = s.community.policy.retention;
  const now = s.clock.now;

  for (const id of sortedKeys(s.events)) {
    const ev = s.events[id]!;
    if (ev.status === "scheduled" || ev.closed_at === undefined) continue;
    if (now - ev.closed_at < r.completed_event_detail_days * DAY_MS) continue;
    s.event_summaries[id] = summarize(ev, r.keep_attendee_list);
    delete s.events[id];
  }

  for (const id of sortedKeys(s.members)) {
    const m = s.members[id]!;
    if (m.status === "active" || m.profile === null || m.ended_at === undefined) continue;
    if (now - m.ended_at < r.removed_member_detail_days * DAY_MS) continue;
    m.profile = null;
  }

  if (s.tasks) {
    const days = closedTaskDays(s.community.policy);
    for (const id of sortedKeys(s.tasks)) {
      const task = s.tasks[id]!;
      if (task.closed_at === undefined || now - task.closed_at < days * DAY_MS) continue;
      delete s.tasks[id];
    }
    pruneTasks(s);
  }
}

function summarize(ev: Event, keepAttendees: boolean) {
  const summary: CommunityState["event_summaries"][EventId] = {
    event_id: ev.event_id,
    title: ev.title,
    starts_at: ev.starts_at,
    status: ev.status as "cancelled" | "completed",
    confirmed_count: confirmedCount(ev),
    attended_count: ev.attended?.length ?? 0,
  };
  if (keepAttendees && ev.attended) summary.attendees = [...ev.attended];
  return summary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function body(op: DecodedOp): Record<string, unknown> {
  return isObject(op.body) ? op.body : reject("malformed");
}

function recordRejection(s: CommunityState, e: Entry, reason: RejectReason): void {
  s.rejected_recent.push({
    seq: e.seq,
    op_id: e.opId,
    author: e.op?.author ?? e.control?.signer ?? "",
    type: e.op?.type ?? e.control?.kind ?? "",
    reason,
  });
  if (s.rejected_recent.length > REJECTED_RECENT_MAX) s.rejected_recent.shift();
}

function isRole(v: unknown): v is Role {
  return v === "member" || v === "organizer" || v === "admin";
}

function parseProfile(v: unknown): Profile | undefined {
  if (!isObject(v) || !isText(v.display_name, 80, 1)) return undefined;
  const p: Profile = { display_name: v.display_name };
  if (v.contact !== undefined) {
    if (!isText(v.contact, 200)) return undefined;
    p.contact = v.contact;
  }
  if (v.prk_binding !== undefined) {
    if (!isHex(v.prk_binding, 64)) return undefined;
    p.prk_binding = v.prk_binding;
  }
  return p;
}

/** Validates a set of 32-byte keys; returns it sorted and de-duplicated, or undefined. */
function normalizeKeySet(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || v.length > 64) return undefined;
  if (!v.every((k) => isHex(k, 32))) return undefined;
  return [...new Set(v as string[])].sort();
}
