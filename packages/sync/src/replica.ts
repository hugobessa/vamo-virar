// A Replica is one device's copy of one community: its keys, the verified
// log tail, the domain state, and an outbox of operations not yet accepted
// by the node. `sync()` is the whole protocol loop of protocol.md §6.2.

import {
  applyInPlace,
  canModerate,
  clone,
  DEFAULT_POLICY,
  DISABLED_RETENTION_MS,
  genesis as genesisState,
  isAdmin,
  isModerator,
  memberIdOf,
  recipientsOf,
  restoreSnapshot,
  stateHash,
  TASK_LIMITS,
  type Attachment,
  type CommunityState,
  type Entry,
  type MemberRecord,
  type NoticeKind,
  type Outcome,
  type Policy,
} from "@vamo-virar/domain";
import {
  decodeKeyEnvelope,
  defaultRng,
  encodeKeyEnvelope,
  encryptionKeyPair,
  generateCommunityRoot,
  generateEncryptionKeyPair,
  generateEpochKeys,
  generateMemberKeys,
  generateSigningKeyPair,
  Keyring,
  LogVerifier,
  mailboxId,
  openBlob,
  openJoinRequest,
  openKeyEnvelope,
  openSnapshot,
  rotateEpoch,
  sealBlob,
  sealJoinRequest,
  sealKeyEnvelope,
  sealOp,
  sealSnapshot,
  communityId,
  sign,
  signingKeyPair,
  verify,
  type ControlArgs,
  type EncryptionKeyPair,
  type JoinRequest,
  type LogEntry,
  type MemberKeys,
  type Rng,
  type SigningKeyPair,
  type SnapshotEnvelope,
} from "@vamo-virar/crypto";
import { decode, encode, equalBytes, fromHex, toHex, type CborValue } from "@vamo-virar/protocol";
import { movedTo, NodeClient, NodeError, type MailboxItem, type RestoreInput, type StaffScope } from "./client.js";
import {
  deviceLabel,
  deviceSetValid,
  listsDevice,
  MAX_DEVICES,
  preferDeviceSet,
  sameDeviceSet,
  signDeviceSet,
  type DeviceSet,
  type UnsignedDeviceSet,
} from "./devices.js";
import { LINK_TTL_MS, type LinkEntry } from "./link.js";
import {
  inviteHash,
  inviteLink,
  openMail,
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  sealMail,
  type Invite,
  type MailMessage,
  type ProbeAnswer,
  type ReportReason,
} from "./invite.js";

export type Status =
  /** Join request sent; waiting for an admin. */
  | "joining"
  /** The admin said no. */
  | "rejected"
  | "active"
  /** The log moved to an epoch whose key has not reached us yet. */
  | "waiting_for_key"
  /** Removed from, or left, the community. */
  | "removed";

export interface OutboxItem {
  opId: string;
  type: string;
  body: CborValue;
  ts: number;
}

/** Everything a Replica persists. Encoded as CBOR by `save()`. */
export interface ReplicaData {
  cid: Uint8Array;
  node: string;
  keys: MemberKeys;
  epochKeys: { epoch: number; key: Uint8Array }[];
  ik?: EncryptionKeyPair;
  /** Only on the founder's device; needed for recovery (§11.4). */
  crk?: SigningKeyPair;
  verifier: { seq: number; head: Uint8Array; eaks: { epoch: number; eak: Uint8Array }[] };
  state: CommunityState | null;
  /** Entries after the last snapshot (all planes), for restore and re-verification. */
  log: LogEntry[];
  /** Every control-plane entry, never pruned. */
  control: LogEntry[];
  snapshot: SnapshotEnvelope | null;
  outbox: OutboxItem[];
  /** Outcomes of our own ops, newest last, bounded. */
  ownOutcomes: { opId: string; type: string; outcome: Outcome }[];
  status: Status;
  /** Probes from organizers waiting for this person's answer (§10.4). */
  incomingProbes?: IncomingProbe[];
  /** Probes this person sent, with the answers received so far. */
  sentProbes?: SentProbe[];
  /** Admins only: reports about members, received and not yet dismissed. */
  reports?: MemberReport[];
  /**
   * Set when we verified an admin-signed `migrate` (§11.3) and have not yet
   * reached the new node. Only signed log entries set it, never a node's say-so.
   */
  pendingMove?: string[];
  /**
   * This device's "last looked at" mark per task, for the news badge. Never
   * synced. `since` stands in for tasks without a mark: the log position when
   * marks started, so an update does not flag every old task as new.
   */
  taskMarks?: TaskMarks;
  /** This device's own mailbox key, once the membership is shared with another device (§10.5.1). */
  device?: { dik: SigningKeyPair; label: string };
  /** The newest device set this device adopted (§10.5.2). Absent: this is the only device. */
  devices?: DeviceSet;
  /** Highest `ver` among adopted sets that listed this device. */
  listedVer?: number;
  /** Secondary devices: the last member-mailbox item read, so each is processed once. */
  peekAfter?: number;
  /** Probes answered or dropped here that the other devices have not been told about yet (§10.5.4). */
  probesDone?: string[];
  /** Probes already answered on some device, so a late copy does not bring them back. */
  answeredProbes?: string[];
  /** Another device unlinked this one: the app should forget the community (§10.5.6). */
  unlinked?: boolean;
  /**
   * Wake-ups (§14) this device still owes: one sealed `ping` per person a
   * submitted op addressed, sent right after the op on the next sync so the
   * recipient's device finds the op in the log when it wakes.
   */
  pings?: PendingPing[];
  /**
   * This device's bookkeeping for the notices screen: the log position up to
   * which this person has looked at their notices, and up to which the device
   * has already shown a system notification. Never synced.
   */
  notices?: NoticeMarks;
  /** The push token last registered on the node, so a changed token is re-sent. */
  pushToken?: string;
  /**
   * Which mailbox that token was registered for: the member's (main device)
   * or this device's own (secondary, §10.5.3). Absent means the member's.
   */
  pushFor?: "member" | "device";
}

/** One of the devices sharing this membership, for display. */
export interface LinkedDevice {
  /** DIK.public, hex. */
  id: string;
  label: string;
  added: number;
  main: boolean;
  /** This device. */
  me: boolean;
}

/** What the main device forwards to the others: the item's content, to seal again. */
type Forward = { kind: "key_env"; epoch: number; key: Uint8Array } | MailMessage;

export interface TaskMarks {
  since: number;
  tasks: Record<string, number>;
}

export interface PendingPing {
  /** The recipient's mailbox and encryption key, fixed when the op was submitted. */
  mbx: Uint8Array;
  mek: Uint8Array;
  what: NoticeKind;
}

export interface NoticeMarks {
  seen: number;
  notified: number;
}

/** Wake-ups are only useful for a while: the op itself stays in the log. */
const PING_TTL_S = 3600;

export interface IncomingProbe {
  probeId: string;
  eventId: string;
  replyTo: Uint8Array;
  replyMbx: Uint8Array;
  expires: number;
}

export interface SentProbe {
  probeId: string;
  eventId: string;
  sentAt: number;
  asked: number;
  replies: Record<string, ProbeAnswer>;
}

export interface MemberReport {
  reportId: string;
  /** Who sent it; checked against their signature. */
  reporter: string;
  /** Who it is about. */
  memberId: string;
  reason: ReportReason;
  details?: string;
  receivedAt: number;
}

const REPORTS_MAX = 500;

export interface SyncReport {
  pushed: number;
  pulled: number;
  status: Status;
  /** Our own ops the community rejected during this sync. */
  rejected: { opId: string; type: string; reason: string }[];
  /**
   * Why changes are waiting in the outbox, if the node refused writes: the
   * community moved and the new node is not reachable yet, the hosting
   * operator suspended it, its storage quota is used up, or an admin
   * disabled it (§11.5).
   */
  blocked?: "moved" | "suspended" | "quota_exceeded" | "disabled";
}

const sameNode = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

export interface PendingJoin {
  intakeId: number;
  request: JoinRequest;
}

const OWN_OUTCOMES_MAX = 200;
const ANSWERED_PROBES_MAX = 200;
/** The main device posts the device set again before the node's 30-day TTL drops it (§10.5.2). */
const DEVICE_SET_REFRESH_MS = 7 * 86_400_000;

export class Replica {
  private keyring: Keyring;
  private verifier: LogVerifier;
  private viewCache: CommunityState | null = null;
  private readonly listeners = new Set<() => void>();
  private syncing: Promise<SyncReport> | null = null;
  private watcher: { onError?: (e: unknown) => void; stream: { close(): void } | null; stopped: boolean } | null = null;

  private constructor(
    public client: NodeClient,
    private data: ReplicaData,
    private readonly rng: Rng = defaultRng,
  ) {
    this.keyring = new Keyring(data.cid);
    for (const k of data.epochKeys) this.keyring.addKey(k.epoch, k.key);
    this.verifier = new LogVerifier(data.cid, this.keyring, {
      seq: data.verifier.seq,
      head: data.verifier.head,
      eaks: new Map(data.verifier.eaks.map((e) => [e.epoch, e.eak])),
    });
  }

  // -------------------------------------------------------------------------
  // Creation, persistence
  // -------------------------------------------------------------------------

  /**
   * Founder flow: CRK, epoch 0, intake key, genesis (§2, §5). With
   * `sync: false` it returns as soon as the node accepts the genesis, so the
   * caller can save the keys before anything else can fail: a community the
   * node holds but no device has the keys for can never be administered.
   */
  static async found(
    client: NodeClient,
    input: { name: string; description?: string; region?: string; whatsapp?: string; displayName: string; policy?: Policy },
    rng: Rng = defaultRng,
    opts: { sync?: boolean } = {},
  ): Promise<Replica> {
    const root = generateCommunityRoot(rng);
    const keys = generateMemberKeys(rng);
    const k0 = generateEpochKeys(root.cid, 0, rng);
    const ik = generateEncryptionKeyPair(rng);
    const body: CborValue = {
      name: input.name,
      description: input.description ?? "",
      region: input.region,
      whatsapp: input.whatsapp,
      policy: (input.policy ?? DEFAULT_POLICY) as unknown as CborValue,
      founders: [{ msk: toHex(keys.signing.pk), mek: toHex(keys.encryption.pk), profile: { display_name: input.displayName } }],
    };
    const env = sealOp({
      cid: root.cid,
      opId: rng(16),
      epoch: k0,
      author: keys.signing,
      base: 0,
      ts: Date.now(),
      type: "community.init",
      body,
      control: {
        kind: "genesis",
        signer: root.crk,
        args: { suite: "VV1", crk: root.crk.pk, admins: [keys.signing.pk], eak: k0.access.pk, ik: ik.pk },
      },
      rng,
    });
    await client.createCommunity(env);
    const r = new Replica(client, Replica.blank(root.cid, client.baseUrl, keys, "active"), rng);
    r.data.ik = ik;
    r.data.crk = root.crk;
    r.addEpochKey(0, k0.key);
    if (opts.sync !== false) await r.sync();
    return r;
  }

  /** Applicant flow (§10.1): fresh per-community keys, sealed request to the intake key. */
  static async join(
    client: NodeClient,
    invite: Invite,
    input: { displayName: string; contact?: string; message?: string },
    rng: Rng = defaultRng,
  ): Promise<Replica> {
    const keys = generateMemberKeys(rng);
    const profile: CborValue = { display_name: input.displayName, contact: input.contact };
    const sealed = sealJoinRequest(
      invite.ik,
      keys,
      { cid: invite.cid, profile, ...(input.message ? { message: input.message } : {}), ...(invite.secret ? { invite_code: invite.secret } : {}) },
      { rng },
    );
    try {
      await client.submitJoinRequest(invite.cid, sealed, invite.secret);
    } catch (e) {
      // The link predates a move. The request is sealed to the intake key, so
      // following the old node's hint can at worst lose it, never expose it.
      const nodes = movedTo(e);
      if (!nodes?.length) throw e;
      client = client.elsewhere(nodes[0]!);
      await client.submitJoinRequest(invite.cid, sealed, invite.secret);
    }
    return new Replica(client, Replica.blank(invite.cid, client.baseUrl, keys, "joining"), rng);
  }

  private static blank(cid: Uint8Array, node: string, keys: MemberKeys, status: Status): ReplicaData {
    return {
      cid,
      node,
      keys,
      epochKeys: [],
      verifier: { seq: 0, head: new Uint8Array(32), eaks: [] },
      state: null,
      log: [],
      control: [],
      snapshot: null,
      outbox: [],
      ownOutcomes: [],
      status,
    };
  }

  save(): Uint8Array {
    this.data.verifier = {
      seq: this.verifier.seq,
      head: this.verifier.head,
      eaks: [...this.verifier.eaks].map(([epoch, eak]) => ({ epoch, eak })),
    };
    return encode(this.data as unknown as CborValue);
  }

  static load(client: NodeClient, bytes: Uint8Array, rng?: Rng): Replica {
    return new Replica(client, decode(bytes) as unknown as ReplicaData, rng);
  }

  /** The node address recorded in a saved replica, to build its client before loading. */
  static savedNode(bytes: Uint8Array): string {
    return (decode(bytes) as unknown as ReplicaData).node;
  }

  /**
   * New device (§10.5.5): the membership another of this person's devices
   * sent. It downloads the community from the node on its first sync and
   * adds itself to the device set there.
   */
  static fromLink(client: NodeClient, entry: LinkEntry, label: string, rng: Rng = defaultRng): Replica {
    const keys: MemberKeys = { signing: signingKeyPair(entry.msk), encryption: encryptionKeyPair(entry.mek) };
    const r = new Replica(client, Replica.blank(entry.cid, client.baseUrl, keys, "active"), rng);
    r.absorbLink(entry, label);
    return r;
  }

  /**
   * Takes what a link carries for a membership this device already has with
   * the same keys: epoch keys it missed, the intake key, and the device set.
   */
  absorbLink(entry: LinkEntry, label: string): void {
    if (!equalBytes(entry.cid, this.data.cid) || !equalBytes(entry.msk, this.data.keys.signing.sk)) throw new Error("not this membership");
    for (const e of entry.epochs) this.addEpochKey(e.epoch, e.key);
    if (entry.ik && !this.data.ik) this.data.ik = encryptionKeyPair(entry.ik);
    if (!this.data.device) this.data.device = { dik: generateSigningKeyPair(this.rng), label: deviceLabel(label) };
    const set = entry.devices;
    if (set && deviceSetValid(this.data.cid, this.data.keys.signing.pk, set) && preferDeviceSet(set, this.data.devices)) this.adoptDeviceSet(set);
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Read side
  // -------------------------------------------------------------------------

  get cid(): Uint8Array {
    return this.data.cid;
  }

  get node(): string {
    return this.data.node;
  }

  get status(): Status {
    return this.data.status;
  }

  get memberId(): string {
    return memberIdOf(toHex(this.data.keys.signing.pk));
  }

  get keys(): MemberKeys {
    return this.data.keys;
  }

  /** Canonical state: what the node has sequenced and we have verified. */
  get canonical(): CommunityState | null {
    return this.data.state;
  }

  /** What the user should see: canonical state plus our not-yet-accepted ops. */
  get view(): CommunityState | null {
    if (!this.viewCache) this.viewCache = this.computeView();
    return this.viewCache;
  }

  get me(): MemberRecord | undefined {
    return this.data.state?.members[this.memberId];
  }

  get isAdmin(): boolean {
    const s = this.data.state;
    const m = this.me;
    return !!s && !!m && isAdmin(s, m);
  }

  get isModerator(): boolean {
    const s = this.data.state;
    const m = this.me;
    return !!s && !!m && isModerator(s, m);
  }

  /** Admin or moderator: may handle join requests, block, unblock and read reports. */
  get canModerate(): boolean {
    const s = this.data.state;
    const m = this.me;
    return !!s && !!m && canModerate(s, m);
  }

  /**
   * The founder's community root key, to show once as a recovery code and
   * keep somewhere safe off the phone (§2.4, §11.4). Undefined elsewhere.
   */
  get recoveryKey(): Uint8Array | undefined {
    return this.data.crk?.sk;
  }

  get pending(): readonly OutboxItem[] {
    return this.data.outbox;
  }

  get ownOutcomes(): ReplicaData["ownOutcomes"] {
    return this.data.ownOutcomes;
  }

  /** Set while an admin has the community marked for deletion (§11.5): nothing can change. */
  get disabled(): { by: string; at: number; deleteAt: number } | undefined {
    const d = this.data.state?.community.disabled;
    return d ? { ...d, deleteAt: d.at + DISABLED_RETENTION_MS } : undefined;
  }

  get epoch(): number {
    return this.keyring.latest()?.epoch ?? -1;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.viewCache = null;
    for (const l of this.listeners) l();
  }

  private computeView(): CommunityState | null {
    const base = this.data.state;
    if (!base) return null;
    if (this.data.outbox.length === 0) return base;
    const view = clone(base);
    let seq = view.clock.seq;
    for (const item of this.data.outbox) {
      const e: Entry = {
        seq: ++seq,
        opId: `${item.opId}00`,
        epoch: view.epoch,
        at: view.clock.now,
        op: { author: toHex(this.data.keys.signing.pk), base: base.clock.seq, ts: item.ts, type: item.type, body: item.body },
      };
      applyInPlace(view, e);
    }
    return view;
  }

  // -------------------------------------------------------------------------
  // Write side
  // -------------------------------------------------------------------------

  /** Queues a domain op (§9). It shows in `view` at once and is sent on the next sync. */
  submit(type: string, body: CborValue): string {
    if (this.disabled) throw new Error("the community is disabled");
    const opId = toHex(this.rng(16));
    this.data.outbox.push({ opId, type, body, ts: Date.now() });
    this.queuePings(type, body);
    this.changed();
    return opId;
  }

  /** One wake-up per person the op addresses (§14), judged against the view before the op. */
  private queuePings(type: string, body: CborValue): void {
    const state = this.data.state;
    if (!state) return;
    for (const r of recipientsOf(state, this.memberId, type, body)) {
      const m = state.members[r.member_id];
      if (!m) continue;
      (this.data.pings ??= []).push({ mbx: mailboxId(this.data.cid, fromHex(m.msk)), mek: fromHex(m.mek), what: r.kind });
    }
  }

  /** Posts the owed wake-ups; one that cannot be posted now is kept for the next sync. */
  private async sendPings(): Promise<void> {
    const pings = this.data.pings ?? [];
    if (pings.length === 0 || !this.keyring.latest()) return;
    const kept: PendingPing[] = [];
    for (const p of pings) {
      try {
        const mail = sealMail(this.data.cid, p.mek, { kind: "ping", what: p.what }, this.rng);
        await this.client.postMailbox(this.data.cid, this.currentAccess(), p.mbx, "ping", mail, PING_TTL_S);
      } catch (e) {
        // The node refused it (full mailbox, writes stopped): a wake-up is not worth more than one try.
        if (!(e instanceof NodeError)) kept.push(p);
      }
    }
    if (kept.length) this.data.pings = kept;
    else delete this.data.pings;
  }

  /** Where this person's notices stand on this device (see `ReplicaData.notices`). */
  get noticeMarks(): NoticeMarks {
    return (this.data.notices ??= { seen: this.data.state?.clock.seq ?? 0, notified: this.data.state?.clock.seq ?? 0 });
  }

  /** This person looked at their notices up to `seq`. */
  markNoticesSeen(seq: number): void {
    const m = this.noticeMarks;
    if (seq <= m.seen) return;
    m.seen = seq;
    if (m.notified < seq) m.notified = seq;
    this.changed();
  }

  /** The device showed system notifications for everything up to `seq`. */
  markNoticesNotified(seq: number): void {
    const m = this.noticeMarks;
    if (seq <= m.notified) return;
    m.notified = seq;
    this.changed();
  }

  get pushToken(): string | undefined {
    return this.data.pushToken;
  }

  /**
   * Tells the node where to send wake-ups for this device (§14). Idempotent:
   * the same token is not sent twice. The node sees the token, never what it
   * is woken for.
   */
  async registerPush(token: string): Promise<void> {
    // With linked devices the node holds one token per mailbox: the main
    // device's goes on the member's mailbox, each secondary's on its own,
    // where the main forwards wake-ups (§10.5.3). Stepping down never deletes
    // the member's token: by then it may be the new main's.
    const target = this.pushTarget();
    if (this.data.pushToken === token && (this.data.pushFor ?? "member") === target.for) return;
    await this.client.putPush(this.data.cid, target.key, token);
    this.data.pushToken = token;
    this.data.pushFor = target.for;
    this.changed();
  }

  async unregisterPush(): Promise<void> {
    if (this.data.pushToken === undefined) return;
    const dik = this.data.device?.dik;
    await this.client.deletePush(this.data.cid, this.data.pushFor === "device" && dik ? dik : this.data.keys.signing);
    delete this.data.pushToken;
    delete this.data.pushFor;
    this.changed();
  }

  private pushTarget(): { key: SigningKeyPair; for: "member" | "device" } {
    const dik = this.data.device?.dik;
    return this.isMainDevice || !dik ? { key: this.data.keys.signing, for: "member" } : { key: dik, for: "device" };
  }

  /** Runs one full sync. Concurrent calls share the same run. */
  sync(): Promise<SyncReport> {
    if (!this.syncing) {
      this.syncing = this.syncOnce().finally(() => {
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  private async syncOnce(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, status: this.data.status, rejected: [] };
    // A move we already verified comes first: the old node may be gone by now.
    if (this.data.pendingMove) await this.followMove();
    await this.checkMail();
    if (
      this.data.status === "rejected" ||
      this.data.status === "removed" ||
      (this.data.status === "joining" && !this.keyring.latest())
    ) {
      report.status = this.data.status;
      return report;
    }
    if (!this.data.state) await this.bootstrap();
    report.pushed = await this.push(report);
    report.pulled = await this.pull(report);
    if (this.data.pendingMove && (await this.followMove())) {
      delete report.blocked;
      report.pushed += await this.push(report);
      report.pulled += await this.pull(report);
    }
    // After the ops, so a woken device finds them in the log.
    await this.sendPings();
    this.updateStatus();
    report.status = this.data.status;
    this.changed();
    return report;
  }

  private updateStatus(): void {
    const me = this.me;
    if (this.data.status === "waiting_for_key") return;
    if (me && me.status !== "active") this.data.status = "removed";
    else if (me && me.status === "active") this.data.status = "active";
  }

  private addEpochKey(epoch: number, key: Uint8Array): void {
    if (this.keyring.get(epoch)) return;
    this.keyring.addKey(epoch, key);
    this.data.epochKeys.push({ epoch, key });
    if (this.data.status === "waiting_for_key") this.data.status = "active";
    if (this.data.status === "joining") this.data.status = "active";
  }

  /**
   * Mail, in the order of §10.5.3: this device's own mailbox (forwarded
   * copies), then the member's mailbox. Only the main device confirms items
   * there, after copying each to the other devices; the others read
   * without confirming. With no device set this is the only device, and the
   * main one.
   */
  private async checkMail(): Promise<void> {
    if (this.data.device) await this.checkDeviceMail();
    const me = this.data.keys;
    const mbx = mailboxId(this.data.cid, me.signing.pk);
    const read = async (after: number): Promise<MailboxItem[] | null> => {
      try {
        const items = await this.client.mailbox(this.data.cid, me.signing, mbx, after);
        this.adoptDeviceSets(items);
        return items;
      } catch (e) {
        if (e instanceof NodeError && e.status === 404) return null;
        throw e;
      }
    };
    const after = this.isMainDevice ? 0 : (this.data.peekAfter ?? 0);
    let items = await read(after);
    if (!items) return;
    // Just became the main device: take over everything still waiting there.
    if (after > 0 && this.isMainDevice) items = (await read(0)) ?? [];
    const main = this.isMainDevice;
    if (main) await this.tidyDeviceSets(items, mbx);
    for (const item of items) {
      if (item.kind === "devices") continue;
      const { handled, forward } = this.handleMail(item);
      if (!handled || !main) continue;
      if (forward && !(await this.forward(forward))) continue; // keep it: no device may miss it
      await this.client.ackMailbox(this.data.cid, me.signing, mbx, item.id);
    }
    if (!main && items.length) this.data.peekAfter = Math.max(this.data.peekAfter ?? 0, ...items.map((i) => i.id));
    if (this.data.device) {
      await this.announceDevice().catch(() => undefined); // retried on the next sync
      await this.flushProbesDone().catch(() => undefined);
    }
  }

  /** Copies the main device forwarded here. Confirmed as soon as they are handled. */
  private async checkDeviceMail(): Promise<void> {
    const dik = this.data.device!.dik;
    const mbx = mailboxId(this.data.cid, dik.pk);
    let items;
    try {
      items = await this.client.mailbox(this.data.cid, dik, mbx);
    } catch (e) {
      if (e instanceof NodeError && e.status === 404) return;
      throw e;
    }
    for (const item of items) {
      const { handled } = item.kind === "devices" ? { handled: true } : this.handleMail(item);
      if (handled) await this.client.ackMailbox(this.data.cid, dik, mbx, item.id);
    }
  }

  /**
   * Applies one mailbox item. `handled` says it may be confirmed; `forward`
   * is what the other devices need from it, if anything.
   */
  private handleMail(item: MailboxItem): { handled: boolean; forward?: Forward } {
    const me = this.data.keys;
    if (item.kind === "key_env") {
      try {
        const env = decodeKeyEnvelope(item.ct);
        const key = openKeyEnvelope(env, me.encryption);
        if (!key) return { handled: false };
        this.addEpochKey(env.epoch, key);
        return { handled: true, forward: { kind: "key_env", epoch: env.epoch, key } };
      } catch {
        return { handled: true }; // malformed: drop it
      }
    }
    const kinds = ["ik_env", "removed", "probe", "probe_reply", "report", "join_result", "probe_done", "ping"];
    if (!kinds.includes(item.kind)) return { handled: false };
    const m = openMail(this.data.cid, item.kind, me.encryption, item.ct);
    if (!m) return { handled: true }; // unreadable: drop it
    switch (m.kind) {
      case "ik_env":
        this.data.ik = encryptionKeyPair(m.ik_sk);
        return { handled: true, forward: m };
      case "removed":
        this.data.status = "removed";
        this.data.outbox = [];
        return { handled: true, forward: m };
      case "probe": {
        const probeId = toHex(m.probe_id);
        if (m.expires <= Date.now()) return { handled: true };
        const probes = (this.data.incomingProbes ??= []);
        if (!probes.some((p) => p.probeId === probeId) && !this.data.answeredProbes?.includes(probeId)) {
          probes.push({ probeId, eventId: m.event_id, replyTo: m.reply_to, replyMbx: m.reply_mbx, expires: m.expires });
        }
        return { handled: true, forward: m };
      }
      case "probe_reply":
        this.acceptProbeReply(m.probe_id, m.member_id, m.answer, m.sig);
        return { handled: true, forward: m };
      case "report":
        // Keep it for a later sync if we have not seen the people in it yet
        // (another admin may have just added the reporter).
        return this.acceptReport(m) ? { handled: true, forward: m } : { handled: false };
      case "join_result":
        if (!m.accepted && this.data.status === "joining") this.data.status = "rejected";
        return { handled: true };
      case "ping":
        // The wake-up did its job by arriving; what it is about is in the log.
        // Copies go on so the node wakes the other devices too (§10.5.3).
        return { handled: true, forward: m };
      case "probe_done":
        if (!verify(me.signing.pk, "vv/probe-done/v1", { cid: this.data.cid, probe_id: m.probe_id }, m.sig)) return { handled: true };
        this.forgetProbe(toHex(m.probe_id));
        return { handled: true, forward: m };
      default:
        return { handled: true };
    }
  }

  /**
   * Main device: a fresh copy of an item for every other device (§10.5.3),
   * sealed again so the node cannot match it to the original. False if any
   * copy did not land; the item then stays for the next sync.
   */
  private async forward(f: Forward): Promise<boolean> {
    const set = this.data.devices;
    const mine = this.data.device?.dik.pk;
    const others = set?.devices.filter((d) => !mine || !equalBytes(d.dik, mine)) ?? [];
    if (others.length === 0) return true;
    const mek = this.data.keys.encryption.pk;
    const ttl = f.kind === "probe" ? Math.max(60, Math.ceil((f.expires - Date.now()) / 1000)) : f.kind === "ping" ? PING_TTL_S : undefined;
    try {
      const access = this.currentAccess();
      for (const d of others) {
        const ct =
          f.kind === "key_env"
            ? encodeKeyEnvelope(sealKeyEnvelope(this.data.cid, f.epoch, f.key, mek, { rng: this.rng }))
            : sealMail(this.data.cid, mek, f, this.rng);
        await this.client.postMailbox(this.data.cid, access, mailboxId(this.data.cid, d.dik), f.kind, ct, ttl);
      }
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Linked devices (§10.5): the device set, and the main device's duties
  // -------------------------------------------------------------------------

  /** Whether this device confirms the member's mail and does the automatic work (§10.5.4). */
  get isMainDevice(): boolean {
    const set = this.data.devices;
    if (!set) return true;
    const d = this.data.device;
    return !!d && equalBytes(set.main, d.dik.pk);
  }

  /** The devices sharing this membership, or an empty list when this is the only one. */
  get linkedDevices(): LinkedDevice[] {
    const set = this.data.devices;
    const mine = this.data.device?.dik.pk;
    if (!set) return [];
    return set.devices.map((d) => ({
      id: toHex(d.dik),
      label: d.label,
      added: d.added,
      main: equalBytes(d.dik, set.main),
      me: !!mine && equalBytes(d.dik, mine),
    }));
  }

  /** Another device unlinked this one; the app should forget this community here. */
  get unlinked(): boolean {
    return !!this.data.unlinked;
  }

  private adoptDeviceSets(items: MailboxItem[]): void {
    for (const item of items) {
      if (item.kind !== "devices") continue;
      const m = openMail(this.data.cid, "devices", this.data.keys.encryption, item.ct);
      if (m?.kind !== "devices" || !deviceSetValid(this.data.cid, this.data.keys.signing.pk, m.set)) continue;
      if (preferDeviceSet(m.set, this.data.devices)) this.adoptDeviceSet(m.set);
    }
  }

  private adoptDeviceSet(set: DeviceSet): void {
    this.data.devices = set;
    const d = this.data.device;
    if (d) {
      if (listsDevice(set, d.dik.pk)) this.data.listedVer = Math.max(this.data.listedVer ?? 0, set.ver);
      // Dropped by a newer set, not by a tie lost while joining it (§10.5.6).
      else if (this.data.listedVer !== undefined && set.ver > this.data.listedVer) this.data.unlinked = true;
    }
    this.changed();
  }

  /**
   * Main device: confirms superseded and invalid sets, keeps the newest copy
   * of the adopted one, and posts it again before the node's TTL drops it.
   */
  private async tidyDeviceSets(items: MailboxItem[], mbx: Uint8Array): Promise<void> {
    const adopted = this.data.devices;
    if (!adopted) return;
    const me = this.data.keys;
    let newest: MailboxItem | undefined;
    for (const item of items) {
      if (item.kind !== "devices") continue;
      const m = openMail(this.data.cid, "devices", me.encryption, item.ct);
      const current = m?.kind === "devices" && deviceSetValid(this.data.cid, me.signing.pk, m.set) && sameDeviceSet(m.set, adopted);
      if (current && (!newest || item.id > newest.id)) {
        if (newest) await this.client.ackMailbox(this.data.cid, me.signing, mbx, newest.id);
        newest = item;
      } else {
        await this.client.ackMailbox(this.data.cid, me.signing, mbx, item.id);
      }
    }
    if (!newest || Date.now() - newest.posted_at > DEVICE_SET_REFRESH_MS) {
      await this.publishDevices(adopted);
      if (newest) await this.client.ackMailbox(this.data.cid, me.signing, mbx, newest.id);
    }
  }

  /** Posts a device set to the member's mailbox, where all their devices read, and adopts it. */
  private async publishDevices(s: UnsignedDeviceSet | DeviceSet): Promise<void> {
    const me = this.data.keys;
    const set = "sig" in s ? s : signDeviceSet(this.data.cid, me.signing, s);
    const mail = sealMail(this.data.cid, me.encryption.pk, { kind: "devices", set }, this.rng);
    await this.client.postMailbox(this.data.cid, this.currentAccess(), mailboxId(this.data.cid, me.signing.pk), "devices", mail);
    if (preferDeviceSet(set, this.data.devices)) this.adoptDeviceSet(set);
  }

  /** The adopted set, on a device that is in it. */
  private requireListed(): { set: DeviceSet; dik: Uint8Array } {
    const set = this.data.devices;
    const d = this.data.device;
    if (!set || !d || !listsDevice(set, d.dik.pk)) throw new Error("this device is not linked");
    return { set, dik: d.dik.pk };
  }

  /**
   * New device: adds itself to the set it received (§10.5.5, step 4), and
   * again if its first try lost a tie to another change.
   */
  private async announceDevice(): Promise<void> {
    const set = this.data.devices;
    const d = this.data.device;
    if (!set || !d || this.data.unlinked || listsDevice(set, d.dik.pk)) return;
    if (this.data.listedVer !== undefined && set.ver > this.data.listedVer) return;
    if (set.devices.length >= MAX_DEVICES || this.data.status !== "active") return;
    await this.publishDevices({
      ver: set.ver + 1,
      main: set.main,
      devices: [...set.devices, { dik: d.dik.pk, label: d.label, added: Date.now() }],
    });
  }

  /** Makes this device part of a device set, creating the set (as its main device) if there is none. */
  private async ensureDevice(label: string): Promise<void> {
    if (!this.data.device) this.data.device = { dik: generateSigningKeyPair(this.rng), label: deviceLabel(label) };
    if (this.data.devices) return;
    const d = this.data.device;
    await this.publishDevices({ ver: 1, main: d.dik.pk, devices: [{ dik: d.dik.pk, label: d.label, added: Date.now() }] });
  }

  /** "Make this the main device." Works without the old one (§10.5.6). */
  async makeMainDevice(): Promise<void> {
    const { set, dik } = this.requireListed();
    if (equalBytes(set.main, dik)) return;
    await this.publishDevices({ ver: set.ver + 1, main: dik, devices: set.devices });
  }

  async renameDevice(label: string): Promise<void> {
    const { set, dik } = this.requireListed();
    const name = deviceLabel(label);
    this.data.device!.label = name;
    await this.publishDevices({ ver: set.ver + 1, main: set.main, devices: set.devices.map((d) => (equalBytes(d.dik, dik) ? { ...d, label: name } : d)) });
  }

  /**
   * Unlinks a device: stops forwarding to it, and an app that still obeys
   * forgets the community there. Not a revocation (§10.5.6). Unlinking this
   * device itself marks it `unlinked`; the app then forgets it here.
   */
  async unlinkDevice(id: string): Promise<void> {
    const { set, dik } = this.requireListed();
    const target = fromHex(id);
    if (!listsDevice(set, target)) return;
    const rest = set.devices.filter((d) => !equalBytes(d.dik, target));
    if (rest.length === 0) throw new Error("cannot unlink the only device");
    const self = equalBytes(target, dik);
    const main = equalBytes(set.main, target) ? (self ? rest[0]!.dik : dik) : set.main;
    await this.publishDevices({ ver: set.ver + 1, main, devices: rest });
    if (self) {
      this.data.unlinked = true;
      this.changed();
    }
  }

  /**
   * What a new device needs to share this membership (§10.5.5). Makes this
   * device part of a device set first. Never the community root key.
   */
  async linkEntry(label: string): Promise<LinkEntry> {
    if (this.data.status !== "active") throw new Error("only active memberships can be linked");
    await this.ensureDevice(label);
    if (this.data.devices!.devices.length >= MAX_DEVICES) throw new Error("too many devices");
    const entry: LinkEntry = {
      cid: this.data.cid,
      node: this.data.node,
      msk: this.data.keys.signing.sk,
      mek: this.data.keys.encryption.sk,
      epochs: this.data.epochKeys.map((e) => ({ epoch: e.epoch, key: e.key })),
      devices: this.data.devices!,
    };
    if (this.data.ik) entry.ik = this.data.ik.sk;
    return entry;
  }

  /** Puts a sealed link bundle in its throwaway mailbox on this community's node. */
  async postLinkBundle(mailbox: Uint8Array, ct: Uint8Array): Promise<void> {
    await this.client.postMailbox(this.data.cid, this.currentAccess(), mailbox, "link", ct, Math.ceil(LINK_TTL_MS / 1000));
  }

  /** Remembers a probe as answered (or dropped) on some device, and stops showing it. */
  private forgetProbe(probeId: string): void {
    this.data.incomingProbes = (this.data.incomingProbes ?? []).filter((x) => x.probeId !== probeId);
    const done = (this.data.answeredProbes ??= []);
    if (!done.includes(probeId)) done.push(probeId);
    if (done.length > ANSWERED_PROBES_MAX) done.shift();
    this.changed();
  }

  /** Tells the other devices which probes were answered here (§10.5.4). */
  private async flushProbesDone(): Promise<void> {
    const queue = this.data.probesDone ?? [];
    const me = this.data.keys;
    while (queue.length) {
      const id = fromHex(queue[0]!);
      const sig = sign(me.signing.sk, "vv/probe-done/v1", { cid: this.data.cid, probe_id: id });
      const mail = sealMail(this.data.cid, me.encryption.pk, { kind: "probe_done", probe_id: id, sig }, this.rng);
      await this.client.postMailbox(this.data.cid, this.currentAccess(), mailboxId(this.data.cid, me.signing.pk), "probe_done", mail);
      queue.shift();
    }
  }

  private currentAccess(): SigningKeyPair {
    const k = this.keyring.latest();
    if (!k) throw new Error("no epoch key yet");
    return k.access;
  }

  /** Starts from the latest snapshot if we can read it, else from genesis (§7.6, §12). */
  private async bootstrap(): Promise<void> {
    const snap = await this.client.snapshot(this.data.cid, this.currentAccess());
    if (!snap) return; // replay from genesis
    const keys = this.keyring.get(snap.epoch);
    if (!keys) return;
    const opened = openSnapshot(snap, keys);
    if (!opened) throw new Error("snapshot failed verification");
    const author = Object.values(opened.state.members).find((m) => m.msk === toHex(opened.author));
    const state = restoreSnapshot({ seq: opened.seq, state: opened.state, state_hash: stateHash(opened.state) });
    if (!author || !canModerate(state, author)) throw new Error("snapshot was not produced by an admin or a moderator");
    this.data.state = state;
    this.data.snapshot = snap;
    this.data.log = [];
    this.data.control = await this.client.controlEntries(this.data.cid, this.currentAccess());
    const eaks = new Map<number, Uint8Array>();
    for (const c of this.data.control) {
      if (c.env.ctrl?.kind === "genesis") eaks.set(0, c.env.ctrl.args.eak);
      if (c.env.ctrl?.kind === "rotate") eaks.set(c.env.ctrl.args.new_epoch, c.env.ctrl.args.eak);
    }
    this.verifier = new LogVerifier(this.data.cid, this.keyring, { seq: opened.seq, head: opened.head, eaks });
  }

  private sealItem(item: OutboxItem) {
    const epoch = this.keyring.latest()!;
    return sealOp({
      cid: this.data.cid,
      opId: fromHex(item.opId),
      epoch,
      author: this.data.keys.signing,
      base: this.verifier.seq,
      ts: item.ts,
      type: item.type,
      body: item.body,
      rng: this.rng,
    });
  }

  /** Sends the outbox. Envelopes are re-sealed each time under the latest epoch, keeping op_ids (§7.4). */
  private async push(report: SyncReport): Promise<number> {
    if (this.data.outbox.length === 0 || !this.keyring.latest()) return 0;
    const batch = this.data.outbox.slice(0, 100);
    let results;
    try {
      ({ results } = await this.client.submit(this.data.cid, this.currentAccess(), batch.map((i) => this.sealItem(i))));
    } catch (e) {
      if (e instanceof NodeError && e.status === 401) {
        // Our access key is no longer current: a rotation we have no key for yet.
        if (this.data.status === "active") this.data.status = "waiting_for_key";
        return 0;
      }
      // Keep everything; the pull that follows finds the signed `migrate`.
      if (e instanceof NodeError && (e.code === "moved" || e.code === "suspended" || e.code === "disabled")) {
        report.blocked = e.code;
        return 0;
      }
      throw e;
    }
    let accepted = 0;
    const keep: OutboxItem[] = [];
    results.forEach((r, i) => {
      const item = batch[i]!;
      if ("seq" in r) {
        accepted++;
      } else if (r.error === "op_conflict") {
        // An earlier send of this op_id landed (we lost the response); it is in the log.
        accepted++;
      } else if (r.error === "epoch_stale" || r.error === "unauthorized") {
        keep.push(item); // retry once we hold the new epoch key
      } else if (r.error === "quota_exceeded" || r.error === "moved" || r.error === "suspended" || r.error === "disabled") {
        report.blocked = r.error;
        keep.push(item); // not about the op: retry later or on the new node
      } else {
        this.recordOwn(item.opId, item.type, { status: "rejected", reason: "malformed" });
      }
    });
    this.data.outbox = [...keep, ...this.data.outbox.slice(batch.length)];
    return accepted;
  }

  private needsKey(e: LogEntry): boolean {
    const latest = this.keyring.latest()?.epoch ?? -1;
    return !!this.me && this.me.status === "active" && !this.keyring.get(e.env.epoch) && e.env.epoch > latest;
  }

  private async pull(report: SyncReport): Promise<number> {
    let pulled = 0;
    for (;;) {
      let page;
      try {
        page = await this.client.entries(this.data.cid, this.currentAccess(), this.verifier.seq);
      } catch (e) {
        if (e instanceof NodeError && e.status === 401) {
          if (this.data.status === "active") this.data.status = "waiting_for_key";
          return pulled;
        }
        throw e;
      }
      if ("gone" in page) {
        // We were offline past compaction: start again from the snapshot.
        this.data.state = null;
        await this.bootstrap();
        if (!this.data.state) throw new Error("log was compacted but no readable snapshot exists");
        continue;
      }
      // Each page applies atomically: if any entry fails verification (a
      // node that rewrote history), nothing from the page is kept.
      const before = { ...this.checkpoint(), rejected: report.rejected.length };
      let pagePulled = 0;
      try {
        for (const e of page.entries) {
          if (this.needsKey(e)) {
            this.data.status = "waiting_for_key";
            return pulled + pagePulled;
          }
          this.ingest(e, report);
          pagePulled++;
        }
      } catch (err) {
        this.rollback(before);
        report.rejected.length = before.rejected;
        throw err;
      }
      pulled += pagePulled;
      if (page.entries.length === 0 || this.verifier.seq >= page.head) return pulled;
    }
  }

  private checkpoint() {
    return {
      pendingMove: this.data.pendingMove,
      state: this.data.state ? clone(this.data.state) : null,
      verifier: this.verifier.checkpoint(),
      log: this.data.log.length,
      control: this.data.control.length,
      own: this.data.ownOutcomes.length,
      rejected: 0,
    };
  }

  private rollback(c: ReturnType<Replica["checkpoint"]>): void {
    if (c.pendingMove) this.data.pendingMove = c.pendingMove;
    else delete this.data.pendingMove;
    this.data.state = c.state;
    this.verifier = new LogVerifier(this.data.cid, this.keyring, c.verifier);
    this.data.log.length = c.log;
    this.data.control.length = c.control;
    this.data.ownOutcomes.length = Math.min(this.data.ownOutcomes.length, c.own);
  }

  private ingest(e: LogEntry, report: SyncReport): void {
    const entry = this.verifier.ingest(e);
    let outcome: Outcome;
    if (!this.data.state) {
      this.data.state = genesisState(entry);
      outcome = { status: "applied" };
    } else {
      outcome = applyInPlace(this.data.state, entry);
    }
    this.data.log.push(e);
    if (e.env.ctrl && !this.data.control.some((c) => c.seq === e.seq)) this.data.control.push(e);
    if (e.env.ctrl?.kind === "migrate" && outcome.status !== "rejected") {
      const nodes = e.env.ctrl.args.nodes;
      if (nodes.length && !nodes.some((n) => sameNode(n, this.data.node))) this.data.pendingMove = [...nodes];
      else delete this.data.pendingMove;
    }
    if (entry.op && entry.op.author === toHex(this.data.keys.signing.pk)) {
      this.recordOwn(entry.opId, entry.op.type, outcome);
      if (outcome.status === "rejected") report.rejected.push({ opId: entry.opId, type: entry.op.type, reason: outcome.reason });
    }
  }

  private recordOwn(opId: string, type: string, outcome: Outcome): void {
    this.data.ownOutcomes.push({ opId, type, outcome });
    if (this.data.ownOutcomes.length > OWN_OUTCOMES_MAX) this.data.ownOutcomes.shift();
  }

  /**
   * Opens the node's notification stream and syncs whenever it says
   * something changed. Follows the community when it moves to another node.
   */
  async watch(onError?: (e: unknown) => void): Promise<() => void> {
    this.watcher?.stream?.close();
    const w: NonNullable<Replica["watcher"]> = { stream: null, stopped: false, ...(onError ? { onError } : {}) };
    this.watcher = w;
    await this.openStream(w);
    return () => {
      w.stopped = true;
      w.stream?.close();
      if (this.watcher === w) this.watcher = null;
    };
  }

  private async openStream(w: NonNullable<Replica["watcher"]>): Promise<void> {
    const s = await this.client.stream(this.data.cid, this.currentAccess(), this.data.keys.signing, () => {
      this.sync().catch((e) => w.onError?.(e));
    });
    if (w.stopped) s.close();
    else w.stream = s;
  }

  /**
   * After a verified `migrate`: switch to the first listed node that already
   * hosts the community. Until one does (the admin is still restoring it),
   * stay on the old node, which keeps serving reads.
   */
  private async followMove(): Promise<boolean> {
    for (const url of this.data.pendingMove ?? []) {
      if (sameNode(url, this.data.node)) {
        delete this.data.pendingMove;
        return false;
      }
      const target = this.client.elsewhere(url);
      try {
        await target.entries(this.data.cid, this.currentAccess(), this.verifier.seq, 1);
      } catch {
        continue; // not restored yet, or unreachable: try the next one later
      }
      this.moveTo(target);
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // "Who could come?" probes (§10.4). The node sees only sealed mailbox
  // items; answers are a single verdict, signed, readable by the organizer.
  // -------------------------------------------------------------------------

  private probeSigned(probeId: Uint8Array, memberId: string, answer: ProbeAnswer): CborValue {
    return { cid: this.data.cid, probe_id: probeId, member_id: memberId, answer };
  }

  /** Organizer: asks every other active member whether they could come. */
  async askWhoCanCome(eventId: string, ttlMs = 72 * 3_600_000): Promise<SentProbe> {
    const state = this.data.state;
    const me = this.me;
    if (!state || !me || (me.role !== "organizer" && me.role !== "admin") || me.status !== "active") {
      throw new Error("only organizers can ask");
    }
    if (!state.events[eventId] || state.events[eventId]!.status !== "scheduled") throw new Error("no such upcoming event");
    const probeId = this.rng(16);
    const expires = Date.now() + ttlMs;
    const myMbx = mailboxId(this.data.cid, this.data.keys.signing.pk);
    const others = Object.values(state.members).filter((m) => m.status === "active" && m.member_id !== this.memberId);
    for (const m of others) {
      const mail = sealMail(
        this.data.cid,
        fromHex(m.mek),
        { kind: "probe", probe_id: probeId, event_id: eventId, reply_to: this.data.keys.encryption.pk, reply_mbx: myMbx, expires },
        this.rng,
      );
      await this.client.postMailbox(this.data.cid, this.currentAccess(), mailboxId(this.data.cid, fromHex(m.msk)), "probe", mail, Math.ceil(ttlMs / 1000));
    }
    const sent: SentProbe = { probeId: toHex(probeId), eventId, sentAt: Date.now(), asked: others.length, replies: {} };
    (this.data.sentProbes ??= []).push(sent);
    this.changed();
    return sent;
  }

  get incomingProbes(): readonly IncomingProbe[] {
    const now = Date.now();
    return (this.data.incomingProbes ?? []).filter((p) => p.expires > now);
  }

  /** Member: answers a probe. Sends only the verdict (no calendar, time or place). */
  async answerProbe(probeId: string, answer: ProbeAnswer): Promise<void> {
    const p = (this.data.incomingProbes ?? []).find((x) => x.probeId === probeId);
    if (!p) throw new Error("no such question");
    const id = fromHex(probeId);
    const sig = sign(this.data.keys.signing.sk, "vv/probe-reply/v1", this.probeSigned(id, this.memberId, answer));
    const mail = sealMail(this.data.cid, p.replyTo, { kind: "probe_reply", probe_id: id, member_id: this.memberId, answer, sig }, this.rng);
    await this.client.postMailbox(this.data.cid, this.currentAccess(), p.replyMbx, "probe_reply", mail, Math.max(60, Math.ceil((p.expires - Date.now()) / 1000)));
    this.dropProbe(probeId);
  }

  /**
   * Member: never answer this one. Indistinguishable from being offline.
   * Linked devices stop showing it too, after the next sync.
   */
  dropProbe(probeId: string): void {
    this.forgetProbe(probeId);
    if (this.data.devices) (this.data.probesDone ??= []).push(probeId);
  }

  private acceptProbeReply(probeId: Uint8Array, memberId: string, answer: ProbeAnswer, sig: Uint8Array): void {
    const sent = (this.data.sentProbes ?? []).find((p) => p.probeId === toHex(probeId));
    const member = this.data.state?.members[memberId];
    if (!sent || !member || member.status !== "active") return;
    if (!verify(fromHex(member.msk), "vv/probe-reply/v1", this.probeSigned(probeId, memberId, answer), sig)) return;
    sent.replies[memberId] = answer;
  }

  /** Organizer: the latest probe for an event and its answers. */
  probeResults(eventId: string): SentProbe | undefined {
    return [...(this.data.sentProbes ?? [])].reverse().find((p) => p.eventId === eventId);
  }

  // -------------------------------------------------------------------------
  // Reports. A member reports another member to the admins; each admin gets
  // a sealed, signed copy in their mailbox. The node and the reported person
  // see nothing; other members do not learn a report was made.
  // -------------------------------------------------------------------------

  private reportSigned(m: { report_id: Uint8Array; reporter: string; member_id: string; reason: ReportReason; details?: string }): CborValue {
    return {
      cid: this.data.cid,
      report_id: m.report_id,
      reporter: m.reporter,
      member_id: m.member_id,
      reason: m.reason,
      ...(m.details !== undefined ? { details: m.details } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Attachments (§9.7): files sealed on the device, stored on the node as blobs
  // -------------------------------------------------------------------------

  /**
   * Seals a file under a fresh key and uploads it. The returned record goes
   * into a `task.create` or `task.update` body; nothing is referenced until
   * that op lands, so an upload the person abandons is an orphan that
   * `tidyBlobs` drops later.
   */
  async uploadAttachment(bytes: Uint8Array, name: string, mime: string): Promise<Attachment> {
    if (!name.trim()) throw new Error("attachment needs a name");
    const sealed = sealBlob(bytes, this.rng);
    const stored = await this.client.putBlob(this.data.cid, this.currentAccess(), sealed.ct);
    return {
      blob_id: toHex(stored.blobId),
      key: toHex(sealed.key),
      nonce: toHex(sealed.nonce),
      name: name.trim().slice(0, TASK_LIMITS.attachmentName),
      mime: mime.trim().slice(0, TASK_LIMITS.attachmentMime) || "application/octet-stream",
      size: bytes.length,
    };
  }

  /** Fetches and opens an attachment. Null when the node no longer has it. */
  async downloadAttachment(att: Attachment): Promise<Uint8Array | null> {
    const ct = await this.client.getBlob(this.data.cid, this.currentAccess(), fromHex(att.blob_id));
    if (!ct) return null;
    const plain = openBlob({ key: fromHex(att.key), nonce: fromHex(att.nonce), blobId: fromHex(att.blob_id) }, ct);
    if (!plain) throw new Error("attachment failed verification");
    return plain;
  }

  /** Blob ids referenced by the current state: everything else on the node is an orphan. */
  private referencedBlobs(): Set<string> {
    const out = new Set<string>();
    for (const task of Object.values(this.data.state?.tasks ?? {})) for (const a of task.attachments) out.add(a.blob_id);
    return out;
  }

  /**
   * Admin or moderator: drops blobs that no task references any more (the
   * task or its event was removed, retention dropped it, or an upload was
   * abandoned). Uploads from the last hour are left alone: their task op may
   * still be on its way. Returns how many were deleted.
   */
  async tidyBlobs(graceMs = 3_600_000): Promise<number> {
    if (!this.canModerate || !this.data.state) return 0;
    const { blobs } = await this.client.listBlobs(this.data.cid, this.data.keys.signing, this.staffScope);
    const keep = this.referencedBlobs();
    const cutoff = Date.now() - graceMs;
    let n = 0;
    for (const b of blobs) {
      if (keep.has(toHex(b.blobId)) || b.at > cutoff) continue;
      await this.client.deleteBlob(this.data.cid, this.data.keys.signing, b.blobId, this.staffScope);
      n++;
    }
    return n;
  }

  /** Any member: reports another member to the community's admins and moderators. */
  async reportMember(memberId: string, reason: ReportReason, details?: string): Promise<void> {
    const state = this.data.state;
    const me = this.me;
    if (!state || !me || me.status !== "active") throw new Error("only members can report");
    if (memberId === this.memberId) throw new Error("you cannot report yourself");
    if (!state.members[memberId]) throw new Error("no such member");
    if (!REPORT_REASONS.includes(reason)) throw new Error("unknown report reason");
    const text = details?.trim() || undefined;
    if (text && text.length > REPORT_DETAILS_MAX) throw new Error("report details are too long");
    // Every admin and moderator except the reported person; one of them reporting keeps a copy too.
    const admins = Object.values(state.members).filter((m) => canModerate(state, m) && m.member_id !== memberId);
    if (admins.length === 0) throw new Error("there is no admin to report to");
    const msg = { report_id: this.rng(16), reporter: this.memberId, member_id: memberId, reason, ...(text ? { details: text } : {}) };
    const sig = sign(this.data.keys.signing.sk, "vv/report/v1", this.reportSigned(msg));
    for (const a of admins) {
      if (a.member_id === this.memberId) {
        this.acceptReport({ kind: "report", ...msg, sig });
        continue;
      }
      const mail = sealMail(this.data.cid, fromHex(a.mek), { kind: "report", ...msg, sig }, this.rng);
      await this.client.postMailbox(this.data.cid, this.currentAccess(), mailboxId(this.data.cid, fromHex(a.msk)), "report", mail);
    }
  }

  /** Stores a verified report. False means "not yet": we do not know the people in it. */
  private acceptReport(m: Extract<MailMessage, { kind: "report" }>): boolean {
    const state = this.data.state;
    if (!state) return false;
    if (!this.canModerate) return true;
    const reporter = state.members[m.reporter];
    if (!reporter || !state.members[m.member_id]) return false;
    if (!verify(fromHex(reporter.msk), "vv/report/v1", this.reportSigned(m), m.sig)) return true;
    const reports = (this.data.reports ??= []);
    const reportId = toHex(m.report_id);
    if (reports.some((r) => r.reportId === reportId)) return true;
    const r: MemberReport = { reportId, reporter: m.reporter, memberId: m.member_id, reason: m.reason, receivedAt: Date.now() };
    if (m.details !== undefined) r.details = m.details;
    reports.push(r);
    if (reports.length > REPORTS_MAX) reports.shift();
    this.changed();
    return true;
  }

  /** Where this device last looked at each task (see `ReplicaData.taskMarks`). */
  get taskMarks(): TaskMarks {
    return (this.data.taskMarks ??= { since: this.data.state?.clock.seq ?? 0, tasks: {} });
  }

  /** Records that this person has seen a task up to `seq`. Marks of tasks that are gone are dropped. */
  markTaskSeen(taskId: string, seq: number): void {
    const marks = this.taskMarks;
    if ((marks.tasks[taskId] ?? marks.since) >= seq) return;
    const tasks = this.view?.tasks ?? {};
    marks.tasks = Object.fromEntries(Object.entries(marks.tasks).filter(([id]) => id in tasks));
    marks.tasks[taskId] = seq;
    this.changed();
  }

  /** Admin or moderator: reports received on this device, newest first. */
  get reports(): readonly MemberReport[] {
    return [...(this.data.reports ?? [])].reverse();
  }

  /** Admin or moderator: closes a report without acting on it. Only on this device. */
  dismissReport(reportId: string): void {
    this.data.reports = (this.data.reports ?? []).filter((r) => r.reportId !== reportId);
    this.changed();
  }

  private dropReportsAbout(memberId: string): void {
    this.data.reports = (this.data.reports ?? []).filter((r) => r.memberId !== memberId);
    this.changed();
  }

  // -------------------------------------------------------------------------
  // Admin flows. These need the node to be reachable.
  // -------------------------------------------------------------------------

  private requireAdmin(): CommunityState {
    if (!this.isAdmin || !this.data.state) throw new Error("only admins can do this");
    return this.data.state;
  }

  private requireModerator(): CommunityState {
    if (!this.canModerate || !this.data.state) throw new Error("only admins and moderators can do this");
    return this.data.state;
  }

  /** Node token scope for join requests and snapshots: admins keep `control`, so older nodes still work. */
  private get staffScope(): StaffScope {
    return this.isAdmin ? "control" : "moderate";
  }

  private async submitNow(type: string, body: CborValue): Promise<Outcome> {
    const opId = this.submit(type, body);
    await this.sync();
    const o = [...this.data.ownOutcomes].reverse().find((x) => x.opId === opId);
    if (!o) throw new Error(`${type} was not sequenced`);
    return o.outcome;
  }

  private async submitControl(type: string, control: ControlArgs, body: CborValue): Promise<void> {
    const env = sealOp({
      cid: this.data.cid,
      opId: this.rng(16),
      epoch: this.keyring.latest()!,
      author: this.data.keys.signing,
      base: this.verifier.seq,
      ts: Date.now(),
      type,
      body,
      control: { ...control, signer: this.data.keys.signing } as never,
      rng: this.rng,
    });
    const { results } = await this.client.submit(this.data.cid, this.currentAccess(), [env]);
    const r = results[0]!;
    if (!("seq" in r)) throw new NodeError(409, r.error, `${type} refused`);
    await this.sync();
  }

  /** Sealed join requests waiting in intake, opened with the intake key. */
  async joinRequests(): Promise<PendingJoin[]> {
    this.requireModerator();
    if (!this.data.ik) throw new Error("this device does not hold the intake key");
    const items = await this.client.intake(this.data.cid, this.data.keys.signing, 0, this.staffScope);
    const out: PendingJoin[] = [];
    for (const item of items) {
      const req = openJoinRequest(item.sealed, this.data.cid, this.data.ik);
      if (req) out.push({ intakeId: item.id, request: req });
      else await this.client.ackIntake(this.data.cid, this.data.keys.signing, item.id, this.staffScope); // unreadable: drop
    }
    return out;
  }

  async approve(p: PendingJoin, role: "member" | "organizer" = "member"): Promise<Outcome> {
    this.requireModerator();
    const outcome = await this.submitNow("member.add", {
      msk: toHex(p.request.msk),
      mek: toHex(p.request.mek),
      profile: p.request.profile,
      role,
    });
    if (outcome.status !== "applied" && !(outcome.status === "rejected" && outcome.reason === "already_exists")) return outcome;
    // New members read the present from a snapshot at the current epoch (§7.6).
    const epoch = this.keyring.latest()!;
    if (epoch.epoch > 0 && (this.data.snapshot?.epoch ?? -1) < epoch.epoch) await this.makeSnapshot();
    const mbx = mailboxId(this.data.cid, p.request.msk);
    await this.client.postMailbox(this.data.cid, epoch.access, mbx, "key_env", encodeKeyEnvelope(sealKeyEnvelope(this.data.cid, epoch.epoch, epoch.key, p.request.mek, { rng: this.rng })));
    await this.client.postMailbox(this.data.cid, epoch.access, mbx, "join_result", sealMail(this.data.cid, p.request.mek, { kind: "join_result", accepted: true }, this.rng), 30 * 86_400);
    await this.client.ackIntake(this.data.cid, this.data.keys.signing, p.intakeId, this.staffScope);
    return outcome;
  }

  async reject(p: PendingJoin, reason?: string): Promise<void> {
    this.requireModerator();
    const mbx = mailboxId(this.data.cid, p.request.msk);
    const msg = sealMail(this.data.cid, p.request.mek, { kind: "join_result", accepted: false, ...(reason ? { reason } : {}) }, this.rng);
    await this.client.postMailbox(this.data.cid, this.currentAccess(), mbx, "join_result", msg, 7 * 86_400);
    await this.client.ackIntake(this.data.cid, this.data.keys.signing, p.intakeId, this.staffScope);
  }

  /** Removes a member and rotates the epoch key so they cannot read anything new (§7.2–§7.3). */
  async removeMember(memberId: string, reason?: string): Promise<void> {
    await this.endMembership("member.remove", memberId, reason);
  }

  /**
   * Blocks a member (§9.2): removes them if they are still active, with the
   * same notice and key rotation as a removal, and bars them from being
   * added back. Reports about them are cleared from this device.
   */
  async blockMember(memberId: string, reason?: string): Promise<void> {
    await this.endMembership("member.block", memberId, reason);
    this.dropReportsAbout(memberId);
  }

  async unblockMember(memberId: string): Promise<void> {
    this.requireModerator();
    const outcome = await this.submitNow("member.unblock", { member_id: memberId });
    if (outcome.status !== "applied") throw new Error(`member.unblock ${outcome.status === "rejected" ? outcome.reason : outcome.status}`);
  }

  private async endMembership(type: "member.remove" | "member.block", memberId: string, reason?: string): Promise<void> {
    const state = type === "member.block" ? this.requireModerator() : this.requireAdmin();
    const target = state.members[memberId];
    if (!target) throw new Error("no such member");
    const wasActive = target.status === "active";
    const wasAdmin = wasActive && state.admin_set.includes(target.msk);
    const wasModerator = !!state.mod_set?.includes(target.msk);
    const outcome = await this.submitNow(type, { member_id: memberId, ...(reason ? { reason } : {}) });
    if (outcome.status !== "applied") throw new Error(`${type} ${outcome.status === "rejected" ? outcome.reason : outcome.status}`);
    if (!wasActive) return; // a former member: nothing to lock them out of
    const notice = sealMail(this.data.cid, fromHex(target.mek), { kind: "removed", ...(reason ? { reason } : {}) }, this.rng);
    await this.client.postMailbox(this.data.cid, this.currentAccess(), mailboxId(this.data.cid, fromHex(target.msk)), "removed", notice, 30 * 86_400);
    if (wasAdmin) await this.setAdmins(this.data.state!.admin_set.filter((k) => k !== target.msk), true);
    if (wasModerator) await this.setModerators((this.data.state!.mod_set ?? []).filter((k) => k !== target.msk));
    await this.rotate({ reason: reason ?? "member removed", removed: [memberId] });
  }

  /** Generates the next epoch key and delivers it to every active member (§7.3). */
  async rotate(body: CborValue = { reason: "scheduled", removed: [] }): Promise<void> {
    const state = this.requireModerator();
    const recipients = Object.values(state.members)
      .filter((m) => m.status === "active")
      .map((m) => ({ mek: fromHex(m.mek), mbx: mailboxId(this.data.cid, fromHex(m.msk)) }));
    const rot = rotateEpoch({
      cid: this.data.cid,
      current: this.keyring.latest()!,
      admin: this.data.keys.signing,
      recipients: recipients.map((r) => r.mek),
      body,
      opId: this.rng(16),
      base: this.verifier.seq,
      ts: Date.now(),
      rng: this.rng,
    });
    const { results } = await this.client.submit(this.data.cid, this.currentAccess(), [rot.op]);
    const r = results[0]!;
    if (!("seq" in r)) throw new NodeError(409, r.error, "rotation refused");
    this.addEpochKey(rot.next.epoch, rot.next.key);
    for (const [i, env] of rot.keyEnvelopes.entries()) {
      await this.client.postMailbox(this.data.cid, rot.next.access, recipients[i]!.mbx, "key_env", encodeKeyEnvelope(env));
    }
    await this.sync();
    await this.makeSnapshot();
  }

  /** Makes a member an admin: data-plane role, control-plane admin set, and the intake key (§9.2, §10.1). */
  async makeAdmin(memberId: string): Promise<void> {
    const state = this.requireAdmin();
    const target = state.members[memberId];
    if (!target || target.status !== "active") throw new Error("no such active member");
    const outcome = await this.submitNow("member.role", { member_id: memberId, role: "admin" });
    if (outcome.status !== "applied") throw new Error("member.role was rejected");
    await this.setAdmins([...new Set([...this.data.state!.admin_set, target.msk])], false);
    if (this.data.ik) {
      const mail = sealMail(this.data.cid, fromHex(target.mek), { kind: "ik_env", ik_sk: this.data.ik.sk }, this.rng);
      await this.client.postMailbox(this.data.cid, this.currentAccess(), mailboxId(this.data.cid, fromHex(target.msk)), "ik_env", mail);
    }
  }

  /** admin.set; when an admin leaves, also replace the intake key and hand it to the remaining admins and moderators. */
  private async setAdmins(adminsHex: string[], newIntakeKey: boolean): Promise<void> {
    const ik = newIntakeKey ? generateEncryptionKeyPair(this.rng) : undefined;
    await this.submitControl("admin.set", { kind: "admin.set", args: { admins: adminsHex.map(fromHex), ...(ik ? { ik: ik.pk } : {}) } }, {});
    if (ik) {
      this.data.ik = ik;
      for (const m of Object.values(this.data.state!.members)) {
        const staff = adminsHex.includes(m.msk) || !!this.data.state!.mod_set?.includes(m.msk);
        if (m.status !== "active" || !staff || m.member_id === this.memberId) continue;
        const mail = sealMail(this.data.cid, fromHex(m.mek), { kind: "ik_env", ik_sk: ik.sk }, this.rng);
        await this.client.postMailbox(this.data.cid, this.currentAccess(), mailboxId(this.data.cid, fromHex(m.msk)), "ik_env", mail);
      }
    }
  }

  /** Admin: makes an active member a moderator and hands them the intake key (§9.2, §10.1). */
  async makeModerator(memberId: string): Promise<void> {
    const state = this.requireAdmin();
    const target = state.members[memberId];
    if (!target || target.status !== "active") throw new Error("no such active member");
    if (isAdmin(state, target)) throw new Error("admins already have every moderator power");
    await this.submitControl("mod.set", { kind: "mod.set", args: { moderators: [...new Set([...(state.mod_set ?? []), target.msk])].map(fromHex) } }, {});
    if (this.data.ik) {
      const mail = sealMail(this.data.cid, fromHex(target.mek), { kind: "ik_env", ik_sk: this.data.ik.sk }, this.rng);
      await this.client.postMailbox(this.data.cid, this.currentAccess(), mailboxId(this.data.cid, fromHex(target.msk)), "ik_env", mail);
    }
  }

  /** Admin: takes moderator powers away. They held the intake key, so it is replaced. */
  async removeModerator(memberId: string): Promise<void> {
    const state = this.requireAdmin();
    const target = state.members[memberId];
    if (!target || !state.mod_set?.includes(target.msk)) throw new Error("not a moderator");
    await this.setModerators(state.mod_set.filter((k) => k !== target.msk));
  }

  /**
   * Admin: drops moderators who are no longer active members (they left, or
   * were removed on another device) from the node's moderator set. Called
   * after each sync; does nothing in the usual case.
   */
  async tidyModerators(): Promise<boolean> {
    const state = this.data.state;
    if (!state?.mod_set || !this.isAdmin) return false;
    const active = new Set(Object.values(state.members).filter((m) => m.status === "active").map((m) => m.msk));
    const keep = state.mod_set.filter((k) => active.has(k));
    if (keep.length === state.mod_set.length) return false;
    await this.setModerators(keep);
    return true;
  }

  /** mod.set, then a new intake key, since whoever left the set held the old one. */
  private async setModerators(modsHex: string[]): Promise<void> {
    await this.submitControl("mod.set", { kind: "mod.set", args: { moderators: modsHex.map(fromHex) } }, {});
    await this.setAdmins(this.data.state!.admin_set, true);
  }

  /**
   * Recovery when every admin device is lost (§11.4): the founder types the
   * community root key (their recovery code) into any member's phone. This
   * device checks the key belongs to this community, signs an `admin.set`
   * with it, and submits it with its own member access. The key is used once
   * and not stored.
   */
  async recoverAdmins(crkSeed: Uint8Array, memberIds: string[]): Promise<void> {
    const state = this.data.state;
    if (!state) throw new Error("not synced yet");
    const crk = signingKeyPair(crkSeed);
    if (toHex(communityId(crk.pk)) !== toHex(this.data.cid) || toHex(crk.pk) !== state.community.crk) {
      throw new Error("this recovery code is not for this community");
    }
    const admins = memberIds.map((id) => {
      const m = state.members[id];
      if (!m || m.status !== "active") throw new Error("new admins must be active members");
      return fromHex(m.msk);
    });
    const env = sealOp({
      cid: this.data.cid,
      opId: this.rng(16),
      epoch: this.keyring.latest()!,
      author: this.data.keys.signing,
      base: this.verifier.seq,
      ts: Date.now(),
      type: "admin.set",
      body: { recovery: true },
      control: { kind: "admin.set", signer: crk, args: { admins } },
      rng: this.rng,
    });
    const { results } = await this.client.submit(this.data.cid, this.currentAccess(), [env]);
    const r = results[0]!;
    if (!("seq" in r)) throw new NodeError(409, r.error, "recovery refused");
    await this.sync();
  }

  /**
   * Admin: marks the community for deletion (§11.5). Writes stop for
   * everyone at once; the node deletes it 30 days later unless another
   * admin re-enables it.
   */
  async disableCommunity(): Promise<void> {
    this.requireAdmin();
    if (this.disabled) throw new Error("the community is disabled");
    await this.submitControl("community.disable", { kind: "disable", args: {} }, {});
  }

  /** Another admin: cancels the deletion. The admin who disabled it cannot. */
  async enableCommunity(): Promise<void> {
    this.requireAdmin();
    const d = this.disabled;
    if (!d) throw new Error("the community is not disabled");
    if (d.by === toHex(this.data.keys.signing.pk)) throw new Error("another admin must re-enable the community");
    await this.submitControl("community.enable", { kind: "enable", args: {} }, {});
  }

  /** Replaces the intake key (e.g. after recovery, when no device holds the old one). */
  async rotateIntakeKey(): Promise<void> {
    const state = this.requireAdmin();
    await this.setAdmins(state.admin_set, true);
  }

  /** Seals the canonical state as a snapshot and uploads it (§12.3). */
  async makeSnapshot(): Promise<SnapshotEnvelope> {
    const state = this.requireModerator();
    const { op_ids: _ignored, ...snapState } = state;
    const snap = sealSnapshot({
      cid: this.data.cid,
      head: this.verifier.head,
      state: snapState,
      epoch: this.keyring.latest()!,
      author: this.data.keys.signing,
      rng: this.rng,
    });
    await this.client.putSnapshot(this.data.cid, this.data.keys.signing, snap, this.staffScope);
    this.data.snapshot = snap;
    this.data.log = this.data.log.filter((e) => e.seq > snap.seq);
    return snap;
  }

  async createInvite(opts: { ttlMs?: number; maxUses?: number } = {}): Promise<string> {
    const state = this.requireAdmin();
    const secret = this.rng(32);
    await this.client.registerInvite(this.data.cid, this.data.keys.signing, inviteHash(secret), Date.now() + (opts.ttlMs ?? 7 * 86_400_000), opts.maxUses ?? 1);
    return inviteLink({ cid: this.data.cid, node: this.data.node, ik: fromHex(state.ik), secret });
  }

  /** A link without a secret, for communities that accept open requests. */
  openInviteLink(): string {
    const state = this.data.state;
    if (!state) throw new Error("not synced yet");
    return inviteLink({ cid: this.data.cid, node: this.data.node, ik: fromHex(state.ik) });
  }

  async setIntakeMode(mode: "open" | "invite_only" | "closed"): Promise<void> {
    this.requireAdmin();
    await this.client.setIntakeMode(this.data.cid, this.data.keys.signing, mode);
  }

  /**
   * Rebuilds this community on another node from what this device holds
   * (§11.3), then switches to it. For when the old node is gone; while it is
   * alive, `migrateTo` also tells every member where to go.
   */
  async restoreTo(target: NodeClient, carry: Pick<RestoreInput, "intakeMode" | "invites"> = {}): Promise<number> {
    this.requireAdmin();
    const snap = this.data.snapshot;
    const genesisPresent = this.data.control.some((c) => c.seq === 1);
    if (!genesisPresent) throw new Error("this device does not hold the genesis entry");
    const tail = this.data.log.filter((e) => e.seq > (snap?.seq ?? 1));
    const head = await target.restoreCommunity({
      controlChain: [...this.data.control].sort((a, b) => a.seq - b.seq),
      ...(snap ? { snapshot: snap } : {}),
      tail,
      ...carry,
    });
    this.moveTo(target);
    return head;
  }

  /**
   * Moves the community to another node, e.g. from managed hosting to a
   * self-hosted node or back (§11.3):
   *
   * 1. a signed `migrate` on the current node freezes writes there;
   * 2. this device, now holding the complete log, restores it on `target`;
   * 3. the current epoch key is re-delivered (mailboxes do not move).
   *
   * Members follow on their next sync, verifying the `migrate` signature
   * themselves. If the restore fails, the move is cancelled.
   */
  async migrateTo(target: NodeClient): Promise<number> {
    this.requireAdmin();
    if (sameNode(target.baseUrl, this.data.node)) throw new Error("the community is already on that node");
    await target.wellKnown(); // reachable and speaks the protocol, before freezing anything
    await this.sync();
    const nodes = [target.baseUrl];
    await this.submitControl("community.migrate", { kind: "migrate", args: { nodes } }, { nodes });
    // The log comes from what this device verified; from the node's export
    // only the node-local settings: intake mode and outstanding invites.
    const { intakeMode, invites } = await this.client.exportCommunity(this.data.cid, this.data.keys.signing);
    let head: number;
    try {
      head = await this.restoreTo(target, { ...(intakeMode ? { intakeMode } : {}), ...(invites ? { invites } : {}) });
    } catch (e) {
      if (!(e instanceof NodeError && e.code === "already_exists")) {
        await this.submitControl("community.migrate", { kind: "migrate", args: { nodes: [] } }, { nodes: [], cancelled: true });
        throw e;
      }
      this.moveTo(target); // an earlier attempt got this far
      head = this.verifier.seq;
    }
    await this.redeliverEpochKey();
    await this.sync();
    return head;
  }

  /** Posts the current epoch key to every other active member's mailbox on this node. */
  private async redeliverEpochKey(): Promise<void> {
    const state = this.requireAdmin();
    const epoch = this.keyring.latest()!;
    for (const m of Object.values(state.members)) {
      if (m.status !== "active" || m.member_id === this.memberId) continue;
      const env = sealKeyEnvelope(this.data.cid, epoch.epoch, epoch.key, fromHex(m.mek), { rng: this.rng });
      await this.client.postMailbox(this.data.cid, epoch.access, mailboxId(this.data.cid, fromHex(m.msk)), "key_env", encodeKeyEnvelope(env));
    }
  }

  /** Where the community says it lives now, if it moved (§11.3). */
  get movedTo(): string[] | undefined {
    return this.data.pendingMove;
  }

  /** Points this replica at a different node hosting the same community. */
  moveTo(target: NodeClient): void {
    this.client = target;
    this.data.node = target.baseUrl;
    if (this.data.pendingMove?.some((n) => sameNode(n, target.baseUrl))) delete this.data.pendingMove;
    const w = this.watcher;
    if (w && !w.stopped) {
      w.stream?.close();
      w.stream = null;
      this.openStream(w).catch((e) => w.onError?.(e));
    }
  }
}
