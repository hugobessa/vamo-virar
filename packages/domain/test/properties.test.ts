// Property tests (architecture.md §53): random operations from random
// authors, delivered in random orders, with duplicates, opaque entries,
// rotations and long node-time jumps. Invariants must hold after every step.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyInPlace, fold, reduce } from "../src/reducer.js";
import { createSnapshot, restoreSnapshot } from "../src/snapshot.js";
import type { CommunityState, Entry, Outcome } from "../src/types.js";
import { clone } from "../src/util.js";
import { canon, commentId, DAY, eventId, HOUR, LogBuilder, person, T0, taskId, type Person } from "./helpers.js";

const ana = person("Ana");
const bia = person("Bia");
const otto = person("Otto");
const m1 = person("M1");
const m2 = person("M2");
const m3 = person("M3");
const outsider = person("Outsider");
const PEOPLE: Person[] = [ana, bia, otto, m1, m2, m3, outsider];
const EVENTS = [eventId(1), eventId(2), eventId(3)];
const TASKS = [taskId(1), taskId(2), taskId(3), taskId(4)];
const TASK_STATUSES = ["awaiting_volunteer", "todo", "in_progress", "blocked", "done", "cancelled"] as const;

const ACTIONS = ["invite", "volunteer", "accept", "decline", "revoke", "approve", "reject", "withdraw"] as const;

const who = fc.integer({ min: 0, max: PEOPLE.length - 1 });
// Biased pickers: mostly the right kind of person, sometimes anyone.
const org = fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 0, max: 2 }) }, { weight: 1, arbitrary: who });
const mem = fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 3, max: 5 }) }, { weight: 1, arbitrary: who });
const admin = fc.oneof({ weight: 4, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: who });
const ev = fc.integer({ min: 0, max: EVENTS.length - 1 });
const task = fc.integer({ min: 0, max: TASKS.length - 1 });
// An event index, or "community level".
const scope = fc.option(ev, { nil: undefined });

const command = fc.oneof(
  { weight: 3, arbitrary: fc.record({ k: fc.constant("taskCreate" as const), actor: org, task, scope, assignee: fc.option(who, { nil: undefined }) }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("taskAssign" as const), actor: who, task, target: fc.option(who, { nil: undefined }) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constantFrom("taskUnassign" as const, "taskJoin" as const, "taskLeave" as const), actor: who, task }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("taskStatus" as const), actor: who, task, status: fc.constantFrom(...TASK_STATUSES) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("taskComment" as const), actor: who, task, n: fc.nat({ max: 5 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("taskMove" as const), actor: org, task, scope }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("taskRemove" as const), actor: who, task }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("eventRemove" as const), actor: admin, ev }) },
  { weight: 6, arbitrary: fc.record({ k: fc.constant("part" as const), actor: who, action: fc.constantFrom(...ACTIONS), ev, target: who }) },
  { weight: 6, arbitrary: fc.record({ k: fc.constant("inviteAccept" as const), actor: org, ev, target: mem, respond: fc.constantFrom("accept", "decline", "none") }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("volunteerApprove" as const), actor: org, ev, target: mem, respond: fc.constantFrom("approve", "reject", "none") }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("withdraw" as const), ev, target: mem }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("remove" as const), actor: admin, target: who }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("leave" as const), actor: who }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("add" as const), actor: admin, target: who }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("role" as const), actor: admin, target: who, role: fc.constantFrom("member", "organizer", "admin") }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("adminSet" as const), actor: admin, targets: fc.subarray([0, 1, 2], { minLength: 1 }) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("rotate" as const), actor: admin }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("update" as const), actor: org, ev, move: fc.boolean(), capacity: fc.option(fc.integer({ min: 1, max: 3 })) }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constantFrom("cancel" as const, "complete" as const), actor: org, ev }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("attendance" as const), actor: org, ev, targets: fc.subarray([3, 4, 5]), fromLive: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("completeAndRecord" as const), actor: org, ev }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("advance" as const), days: fc.integer({ min: 0, max: 90 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("opaque" as const) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("graceOp" as const), actor: who }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("dup" as const), which: fc.nat() }) },
);
type Command = typeof command extends fc.Arbitrary<infer T> ? T : never;

function baseLog(): LogBuilder {
  const b = new LogBuilder([ana]);
  b.add(ana, bia, "organizer");
  b.add(ana, otto, "organizer");
  b.add(ana, m1);
  b.add(ana, m2);
  b.add(ana, m3);
  b.createEvent(bia, 1, { capacity: 2 });
  b.createEvent(otto, 2);
  b.createEvent(bia, 3, { capacity: 1 });
  // Three tasks to start with; the fourth id is left for random creation.
  b.createTask(bia, 1, { event_id: EVENTS[0] });
  b.createTask(otto, 2, { event_id: EVENTS[1], assignee: m1.id });
  b.createTask(ana, 3, { assignee: m2.id, volunteers: [m3.id] });
  return b;
}

/**
 * Turns commands into log entries. Authors write at the epoch they observe in
 * the live state, as a real device would.
 */
function materialize(cmds: Command[]): Entry[] {
  const b = baseLog();
  const live = fold(b.entries).state;
  const advance = (e: Entry) => applyInPlace(live, e);
  for (const c of cmds) {
    b.epoch = live.epoch;
    const emit = (make: () => Entry) => {
      b.epoch = live.epoch;
      advance(make());
    };
    let e: Entry;
    switch (c.k) {
      case "inviteAccept": {
        const [o, t, evId] = [PEOPLE[c.actor]!, PEOPLE[c.target]!, EVENTS[c.ev]!];
        if (c.respond !== "none") emit(() => b.part(o, "invite", evId, t));
        e = c.respond === "none" ? b.part(o, "invite", evId, t) : b.part(t, c.respond, evId);
        break;
      }
      case "volunteerApprove": {
        const [o, t, evId] = [PEOPLE[c.actor]!, PEOPLE[c.target]!, EVENTS[c.ev]!];
        if (c.respond !== "none") emit(() => b.part(t, "volunteer", evId));
        e = c.respond === "none" ? b.part(t, "volunteer", evId) : b.part(o, c.respond, evId, t);
        break;
      }
      case "withdraw":
        e = b.part(PEOPLE[c.target]!, "withdraw", EVENTS[c.ev]!);
        break;
      case "part": {
        const target = ["invite", "revoke", "approve", "reject"].includes(c.action) ? PEOPLE[c.target] : undefined;
        e = b.part(PEOPLE[c.actor]!, c.action, EVENTS[c.ev]!, target);
        break;
      }
      case "remove":
        e = b.op(PEOPLE[c.actor]!, "member.remove", { member_id: PEOPLE[c.target]!.id });
        break;
      case "leave":
        e = b.op(PEOPLE[c.actor]!, "member.leave", {});
        break;
      case "add":
        e = b.add(PEOPLE[c.actor]!, PEOPLE[c.target]!);
        break;
      case "role":
        e = b.op(PEOPLE[c.actor]!, "member.role", { member_id: PEOPLE[c.target]!.id, role: c.role });
        break;
      case "adminSet":
        e = b.adminSet(PEOPLE[c.actor]!, c.targets.map((i) => PEOPLE[i]!));
        break;
      case "rotate":
        e = b.rotate(PEOPLE[c.actor]!, { newEpoch: live.epoch + 1, epoch: live.epoch });
        break;
      case "update": {
        const body: Record<string, unknown> = { event_id: EVENTS[c.ev]! };
        if (c.move) {
          body.starts_at = T0 + 12 * DAY;
          body.ends_at = T0 + 12 * DAY + 2 * HOUR;
        }
        if (c.capacity !== null) body.capacity = c.capacity;
        e = b.op(PEOPLE[c.actor]!, "event.update", body);
        break;
      }
      case "cancel":
      case "complete":
        e = b.op(PEOPLE[c.actor]!, `event.${c.k}`, { event_id: EVENTS[c.ev]! });
        break;
      case "completeAndRecord": {
        const evId = EVENTS[c.ev]!;
        emit(() => b.op(PEOPLE[c.actor]!, "event.complete", { event_id: evId }));
        const liveEv = live.events[evId];
        const confirmed = liveEv
          ? Object.keys(liveEv.participations).filter((id) => liveEv.participations[id]!.status === "confirmed")
          : [];
        e = b.op(PEOPLE[c.actor]!, "event.attendance", { event_id: evId, attended: confirmed });
        break;
      }
      case "attendance": {
        // Either what the organizer saw (the confirmed list) or an arbitrary guess.
        const liveEv = live.events[EVENTS[c.ev]!];
        const confirmed = liveEv
          ? Object.keys(liveEv.participations).filter((id) => liveEv.participations[id]!.status === "confirmed")
          : [];
        e = b.op(PEOPLE[c.actor]!, "event.attendance", {
          event_id: EVENTS[c.ev]!,
          attended: c.fromLive ? confirmed : c.targets.map((i) => PEOPLE[i]!.id),
        });
        break;
      }
      case "taskCreate": {
        const body: Record<string, unknown> = { task_id: TASKS[c.task]!, title: "t", tags: ["Som", "arte"] };
        if (c.scope !== undefined) body.event_id = EVENTS[c.scope];
        if (c.assignee !== undefined) body.assignee = PEOPLE[c.assignee]!.id;
        e = b.op(PEOPLE[c.actor]!, "task.create", body);
        break;
      }
      case "taskAssign": {
        const body: Record<string, unknown> = { task_id: TASKS[c.task]! };
        if (c.target !== undefined) body.member_id = PEOPLE[c.target]!.id;
        e = b.op(PEOPLE[c.actor]!, "task.assign", body);
        break;
      }
      case "taskUnassign":
      case "taskJoin":
      case "taskLeave":
        e = b.op(PEOPLE[c.actor]!, `task.${c.k.slice(4).toLowerCase()}`, { task_id: TASKS[c.task]! });
        break;
      case "taskStatus":
        e = b.op(PEOPLE[c.actor]!, "task.status", { task_id: TASKS[c.task]!, status: c.status });
        break;
      case "taskComment":
        e = b.op(PEOPLE[c.actor]!, "task.comment", { task_id: TASKS[c.task]!, comment_id: commentId(c.n), body: "oi" });
        break;
      case "taskMove":
        e = b.op(PEOPLE[c.actor]!, "task.update", { task_id: TASKS[c.task]!, event_id: c.scope === undefined ? null : EVENTS[c.scope], title: "moved" });
        break;
      case "taskRemove":
        e = b.op(PEOPLE[c.actor]!, "task.remove", { task_id: TASKS[c.task]! });
        break;
      case "eventRemove":
        e = b.op(PEOPLE[c.actor]!, "event.remove", { event_id: EVENTS[c.ev]! });
        break;
      case "advance":
        e = b.op(ana, "member.profile", { profile: { display_name: "Ana" } }, { at: b.at + c.days * DAY });
        break;
      case "opaque":
        e = b.opaque();
        break;
      case "graceOp":
        e = b.op(PEOPLE[c.actor]!, "member.profile", { profile: { display_name: "x" } }, {
          epoch: Math.max(0, live.epoch - 1),
        });
        break;
      case "dup": {
        const prev = b.entries[c.which % b.entries.length]!;
        e = b.op(ana, "member.profile", { profile: { display_name: "dup" } }, { opId: prev.opId });
        break;
      }
    }
    advance(e);
  }
  return b.entries;
}

function checkInvariants(s: CommunityState, log: readonly Entry[], outcomes: readonly Outcome[]): void {
  expect(s.admin_set.length).toBeGreaterThan(0);

  // Who explicitly said yes to which event (accept, or volunteer).
  const consented = new Set<string>();
  log.forEach((e, i) => {
    if (outcomes[i]?.status !== "applied" || !e.op) return;
    if (e.op.type === "participation.accept" || e.op.type === "participation.volunteer") {
      const evId = (e.op.body as { event_id: string }).event_id;
      consented.add(`${evId}:${e.op.author}`);
    }
  });

  for (const ev of Object.values(s.events)) {
    for (const [mid, p] of Object.entries(ev.participations)) {
      const m = s.members[mid];
      expect(m, "participation for unknown member").toBeDefined();
      if (p.status === "confirmed" || p.status === "reconfirm") {
        // No silent assignment (architecture.md §21).
        expect(consented.has(`${ev.event_id}:${m!.msk}`), "confirmed without consent").toBe(true);
      }
      if (ev.status === "scheduled" && m!.status !== "active") {
        expect(["invited", "volunteered", "confirmed", "reconfirm"]).not.toContain(p.status);
      }
    }
    if (ev.status === "scheduled") {
      for (const id of ev.organizers) expect(s.members[id]!.status).toBe("active");
    }
    if (ev.attended) {
      for (const id of ev.attended) expect(ev.participations[id]?.status).toBe("confirmed");
    }
  }
  for (const id of Object.keys(s.event_summaries)) expect(s.events[id]).toBeUndefined();

  // Tasks (§9.7).
  if (s.tasks) expect(Object.keys(s.tasks).length, "empty tasks map must be absent").toBeGreaterThan(0);
  for (const t of Object.values(s.tasks ?? {})) {
    const open = t.status !== "done" && t.status !== "cancelled";
    if (t.event_id !== undefined) {
      expect(s.events[t.event_id] ?? s.event_summaries[t.event_id], "task points at a vanished event").toBeDefined();
    }
    if (open) {
      // "Waiting for a volunteer" means exactly "nobody is assigned".
      expect(t.assignee === undefined, `${t.status} with assignee=${t.assignee}`).toBe(t.status === "awaiting_volunteer");
      expect(t.closed_at).toBeUndefined();
      if (t.assignee !== undefined) expect(s.members[t.assignee]!.status).toBe("active");
      for (const id of t.volunteers) expect(s.members[id]!.status).toBe("active");
    } else {
      expect(t.closed_at).toBeDefined();
    }
    if (t.assignee !== undefined) expect(t.volunteers).not.toContain(t.assignee);
    expect([...t.volunteers].sort()).toEqual(t.volunteers);
    expect(new Set(t.volunteers).size).toBe(t.volunteers.length);
    expect([...t.tags].sort()).toEqual(t.tags);
    expect(t.history.length).toBeGreaterThan(0);
    expect(t.history.at(-1)!.status).toBe(t.status);
    for (let i = 1; i < t.history.length; i++) expect(t.history[i]!.seq).toBeGreaterThan(t.history[i - 1]!.seq);
    for (let i = 1; i < t.comments.length; i++) expect(t.comments[i]!.seq).toBeGreaterThan(t.comments[i - 1]!.seq);
    for (const c of t.comments) expect(s.members[c.author], "comment by unknown member").toBeDefined();
  }
}

const RUNS = { numRuns: 300 };
const commands = fc.array(command, { minLength: 1, maxLength: 120 });

describe("properties", () => {
  it("invariants hold after every step", () => {
    fc.assert(
      fc.property(commands, (cmds) => {
        const log = materialize(cmds);
        const { state, outcomes } = fold(log);
        checkInvariants(state, log, outcomes);
      }),
      RUNS,
    );
  });

  it("capacity is never exceeded by a new confirmation", () => {
    fc.assert(
      fc.property(commands, (cmds) => {
        const log = materialize(cmds);
        let s = fold(log.slice(0, 1)).state;
        for (const e of log.slice(1)) {
          const before = Object.fromEntries(
            Object.values(s.events).map((ev) => [ev.event_id, countConfirmed(ev.participations)]),
          );
          s = reduce(s, e).state;
          for (const ev of Object.values(s.events)) {
            const n = countConfirmed(ev.participations);
            if (n > (before[ev.event_id] ?? 0) && ev.capacity !== undefined) {
              expect(n).toBeLessThanOrEqual(ev.capacity);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("restoring a snapshot at any point and replaying the tail equals the full fold", () => {
    fc.assert(
      fc.property(commands, fc.nat(), (cmds, cutSeed) => {
        const log = materialize(cmds);
        const full = fold(log);
        const cut = 1 + (cutSeed % log.length);
        const prefix = fold(log.slice(0, cut)).state;
        const restored = restoreSnapshot(createSnapshot(prefix));
        for (const e of log.slice(cut)) applyInPlace(restored, e);
        // Dedupe history before the snapshot is the node's job (§6.3), so
        // replays of pre-snapshot op_ids are excluded from this comparison.
        const preIds = new Set(log.slice(0, cut).map((e) => e.opId));
        if (log.slice(cut).some((e) => preIds.has(e.opId))) return;
        expect(canon(restored)).toBe(canon(full.state));
      }),
      RUNS,
    );
  });

  it("folding is deterministic and reduce never mutates its input", () => {
    fc.assert(
      fc.property(commands, (cmds) => {
        const log = materialize(cmds);
        const a = fold(log);
        const b = fold(clone(log));
        expect(canon(a.state)).toBe(canon(b.state));
        expect(a.outcomes).toEqual(b.outcomes);

        const mid = fold(log.slice(0, Math.ceil(log.length / 2))).state;
        const snapshot = canon(mid, []);
        const next = log[Math.ceil(log.length / 2)];
        if (next) reduce(mid, next);
        expect(canon(mid, [])).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it("a rejected op changes nothing but bookkeeping", () => {
    fc.assert(
      fc.property(commands, (cmds) => {
        const log = materialize(cmds);
        let s = fold(log.slice(0, 1)).state;
        for (const e of log.slice(1)) {
          const r = reduce(s, e);
          if (r.outcome.status === "rejected" && !e.control) {
            // Same entry with a type no reducer knows: identical bookkeeping, no domain effect.
            const inert = reduce(s, { ...e, op: { ...e.op!, type: "x.inert" } });
            expect(canon(r.state, ["op_ids", "rejected_recent"])).toBe(
              canon(inert.state, ["op_ids", "rejected_recent"]),
            );
          }
          s = r.state;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("duplicate op_ids have no effect", () => {
    fc.assert(
      fc.property(commands, (cmds) => {
        const log = materialize(cmds);
        const seen = new Set<string>();
        const withoutDupEffects = log.map((e) => {
          if (seen.has(e.opId)) {
            return { ...e, opId: `${e.opId}ff`, op: { ...e.op!, type: "x.inert" } };
          }
          seen.add(e.opId);
          return e;
        });
        const a = fold(log).state;
        const b = fold(withoutDupEffects).state;
        expect(canon(a, ["op_ids", "rejected_recent"])).toBe(canon(b, ["op_ids", "rejected_recent"]));
      }),
      RUNS,
    );
  });

  it("a device offline while others perform 1,000 operations catches up to the same state", () => {
    fc.assert(
      fc.property(fc.array(command, { minLength: 1000, maxLength: 1000 }), fc.nat(), (cmds, seed) => {
        const log = materialize(cmds);
        const online = fold(log).state;
        // Device A last synced somewhere early, then replays everything it missed.
        const offlineAt = 1 + (seed % 50);
        const deviceA = fold(log.slice(0, offlineAt)).state;
        for (const e of log.slice(offlineAt)) applyInPlace(deviceA, e);
        expect(canon(deviceA)).toBe(canon(online));
      }),
      { numRuns: 5 },
    );
  });
});

function countConfirmed(ps: Record<string, { status: string }>): number {
  return Object.values(ps).filter((p) => p.status === "confirmed").length;
}

describe("coverage sanity", () => {
  it("random logs do exercise the task machinery", () => {
    let applied = 0;
    let total = 0;
    for (const cmds of fc.sample(commands, 40)) {
      const log = materialize(cmds);
      const { outcomes } = fold(log);
      log.forEach((e, i) => {
        if (e.op?.type.startsWith("task.")) {
          total++;
          if (outcomes[i]?.status === "applied") applied++;
        }
      });
    }
    expect(total).toBeGreaterThan(50);
    expect(applied).toBeGreaterThan(total / 5);
  });
});
