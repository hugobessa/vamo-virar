// Mentions, assignments and invitations leave enough in the state to tell
// the person concerned, and `recipientsOf` names who to wake up (§14).

import { describe, expect, it } from "vitest";
import { recipientsOf } from "../src/notify.js";
import { fold, TASK_LIMITS } from "../src/reducer.js";
import { createSnapshot, stateHash } from "../src/snapshot.js";
import type { Outcome } from "../src/types.js";
import { commentId, LogBuilder, person, taskId } from "./helpers.js";

function last(b: LogBuilder): { state: ReturnType<typeof fold>["state"]; out: Outcome } {
  const r = fold(b.entries);
  return { state: r.state, out: r.outcomes.at(-1)! };
}

const rejected = (reason: string) => ({ status: "rejected", reason });
const applied = { status: "applied" };

function setup() {
  const ana = person("Ana");
  const bia = person("Bia");
  const caio = person("Caio");
  const davi = person("Davi");
  const b = new LogBuilder([ana]);
  b.add(ana, bia, "organizer");
  b.add(ana, caio);
  b.add(ana, davi);
  const ev = b.createEvent(bia, 1);
  return { b, ana, bia, caio, davi, ev };
}

describe("mentions in comments", () => {
  it("are kept as sorted, unique member ids; absent when there are none", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id, volunteers: [davi.id] });
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(1), body: "@Davi @Bia vocês levam?", mentions: [davi.id, bia.id, davi.id] });
    expect(last(b).out).toEqual(applied);
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(2), body: "sem ninguém", mentions: [] });
    expect(last(b).out).toEqual(applied);
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(3), body: "nem o campo" });
    const [c1, c2, c3] = last(b).state.tasks![id]!.comments;
    expect(c1!.mentions).toEqual([bia.id, davi.id].sort());
    expect("mentions" in c2!).toBe(false);
    expect("mentions" in c3!).toBe(false);
  });

  it("must name active members, at most TASK_LIMITS.mentions of them", () => {
    const { b, ana, bia, caio, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(1), body: "x", mentions: [person("Zed").id] });
    expect(last(b).out).toEqual(rejected("unknown_target"));
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(1), body: "x", mentions: ["not hex"] });
    expect(last(b).out).toEqual(rejected("malformed"));
    const crowd = Array.from({ length: TASK_LIMITS.mentions + 1 }, (_, i) => person(`M${i}`));
    for (const p of crowd) b.add(ana, p);
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(1), body: "x", mentions: crowd.map((p) => p.id) });
    expect(last(b).out).toEqual(rejected("malformed"));
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(1), body: "x", mentions: crowd.slice(1).map((p) => p.id) });
    expect(last(b).out).toEqual(applied);
  });

  it("an edit replaces the mentions, and may clear them", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(1), body: "@Davi", mentions: [davi.id] });
    b.op(caio, "task.comment_edit", { task_id: id, comment_id: commentId(1), body: "@Bia", mentions: [bia.id] });
    expect(last(b).state.tasks![id]!.comments[0]!.mentions).toEqual([bia.id]);
    b.op(caio, "task.comment_edit", { task_id: id, comment_id: commentId(1), body: "ninguém" });
    expect("mentions" in last(b).state.tasks![id]!.comments[0]!).toBe(false);
  });

  it("round-trip through a snapshot unchanged", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(1), body: "@Davi", mentions: [davi.id] });
    const { state } = last(b);
    const snap = createSnapshot(state);
    expect(snap.state_hash).toBe(stateHash(state));
    expect(snap.state.tasks![id]!.comments[0]!.mentions).toEqual([davi.id]);
  });
});

describe("who assigned a task, and who invited", () => {
  it("records the assigner and the log position; cleared when the task returns to the pool", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev });
    expect(last(b).state.tasks![id]!.assigned).toBeUndefined();
    const take = b.op(caio, "task.assign", { task_id: id });
    expect(last(b).state.tasks![id]!.assigned).toEqual({ by: caio.id, seq: take.seq });
    const handover = b.op(bia, "task.assign", { task_id: id, member_id: davi.id });
    expect(last(b).state.tasks![id]!.assigned).toEqual({ by: bia.id, seq: handover.seq });
    b.op(davi, "task.unassign", { task_id: id });
    expect(last(b).state.tasks![id]!.assigned).toBeUndefined();
    const created = b.createTask(bia, 2, { event_id: ev, assignee: caio.id });
    const t = last(b).state.tasks![created]!;
    expect(t.assigned).toEqual({ by: bia.id, seq: t.created_seq });
    // Leaving the community clears it too.
    b.op(caio, "member.leave", {});
    expect(last(b).state.tasks![created]!.assigned).toBeUndefined();
  });

  it("an organizer's participation changes carry `by`; the member's own do not", () => {
    const { b, bia, caio, ev } = setup();
    const inv = b.part(bia, "invite", ev, caio);
    expect(last(b).state.events[ev]!.participations[caio.id]).toEqual({ status: "invited", updated_seq: inv.seq, by: bia.id });
    b.part(caio, "accept", ev);
    expect(last(b).state.events[ev]!.participations[caio.id]!.by).toBeUndefined();
  });
});

describe("recipientsOf", () => {
  it("names mentioned, assigned and invited active members, never the author", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    const { state } = last(b);
    expect(recipientsOf(state, caio.id, "task.comment", { task_id: id, comment_id: commentId(1), body: "x", mentions: [davi.id, caio.id, bia.id, "junk", person("Zed").id] })).toEqual([
      { member_id: davi.id, kind: "mention" },
      { member_id: bia.id, kind: "mention" },
    ]);
    expect(recipientsOf(state, bia.id, "task.create", { task_id: taskId(9), title: "t", assignee: davi.id })).toEqual([{ member_id: davi.id, kind: "assigned" }]);
    expect(recipientsOf(state, bia.id, "task.assign", { task_id: id, member_id: davi.id })).toEqual([{ member_id: davi.id, kind: "assigned" }]);
    expect(recipientsOf(state, caio.id, "task.assign", { task_id: id })).toEqual([]);
    expect(recipientsOf(state, bia.id, "participation.invite", { event_id: ev, member_id: davi.id })).toEqual([{ member_id: davi.id, kind: "invited" }]);
    expect(recipientsOf(state, bia.id, "participation.approve", { event_id: ev, member_id: davi.id })).toEqual([]);
    expect(recipientsOf(state, bia.id, "task.comment", "not an object")).toEqual([]);
  });

  it("on an edit, only people the edit adds", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(1), body: "@Davi", mentions: [davi.id] });
    const { state } = last(b);
    expect(recipientsOf(state, caio.id, "task.comment_edit", { task_id: id, comment_id: commentId(1), body: "@Davi @Bia", mentions: [davi.id, bia.id] })).toEqual([
      { member_id: bia.id, kind: "mention" },
    ]);
  });
});
