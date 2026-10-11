// Tasks (protocol.md §9.7): who may create, assign, move and discuss them,
// how they follow their event and their people, and when they are dropped.

import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../src/policy.js";
import { canManageTask, canSeeTask, fold, TASK_LIMITS } from "../src/reducer.js";
import { createSnapshot, restoreSnapshot, stateHash } from "../src/snapshot.js";
import type { Outcome } from "../src/types.js";
import { attachment, canon, commentId, DAY, LogBuilder, person, taskId } from "./helpers.js";

function last(b: LogBuilder): { state: ReturnType<typeof fold>["state"]; out: Outcome } {
  const r = fold(b.entries);
  return { state: r.state, out: r.outcomes.at(-1)! };
}

const rejected = (reason: string) => ({ status: "rejected", reason });
const applied = { status: "applied" };

/** Ana admin, Bia organizer, Caio and Davi members, Mila moderator; Bia's event e1. */
function setup() {
  const ana = person("Ana");
  const bia = person("Bia");
  const caio = person("Caio");
  const davi = person("Davi");
  const mila = person("Mila");
  const b = new LogBuilder([ana]);
  b.add(ana, bia, "organizer");
  b.add(ana, caio);
  b.add(ana, davi);
  b.add(ana, mila);
  b.modSet(ana, [mila]);
  const ev = b.createEvent(bia, 1);
  return { b, ana, bia, caio, davi, mila, ev };
}

describe("creating tasks", () => {
  it("event organizers, admins and moderators create tasks in an event; members cannot", () => {
    const { b, ana, bia, caio, mila, ev } = setup();
    b.createTask(caio, 1, { event_id: ev });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.createTask(bia, 1, { event_id: ev });
    expect(last(b).out).toEqual(applied);
    b.createTask(ana, 2, { event_id: ev });
    expect(last(b).out).toEqual(applied);
    b.createTask(mila, 3, { event_id: ev });
    expect(last(b).out).toEqual(applied);
    const t = last(b).state.tasks![taskId(1)]!;
    expect(t.status).toBe("awaiting_volunteer");
    expect(t.priority).toBe("normal");
    expect(t.history).toEqual([{ status: "awaiting_volunteer", by: bia.id, seq: t.created_seq }]);
  });

  it("an organizer of another event has no say in this one", () => {
    const { b, ana, bia, ev } = setup();
    const fabi = person("Fabi");
    b.add(ana, fabi, "organizer");
    b.createEvent(fabi, 2);
    b.createTask(fabi, 1, { event_id: ev });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.createTask(bia, 1, { event_id: ev });
    expect(last(b).out).toEqual(applied);
  });

  it("community-level tasks belong to admins and moderators only", () => {
    const { b, ana, bia, mila } = setup();
    b.createTask(bia, 1);
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.createTask(ana, 1);
    expect(last(b).out).toEqual(applied);
    b.createTask(mila, 2);
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.tasks![taskId(1)]!.event_id).toBeUndefined();
  });

  it("a task created with an assignee starts in todo", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id, volunteers: [davi.id] });
    const t = last(b).state.tasks![id]!;
    expect(t.status).toBe("todo");
    expect(t.assignee).toBe(caio.id);
    expect(t.volunteers).toEqual([davi.id]);
  });

  it("validates fields and rejects unknown targets", () => {
    const { b, bia, caio, ev } = setup();
    b.createTask(bia, 1, { event_id: "00".repeat(16) });
    expect(last(b).out).toEqual(rejected("unknown_target"));
    b.createTask(bia, 1, { event_id: ev, title: "" });
    expect(last(b).out).toEqual(rejected("malformed"));
    b.createTask(bia, 1, { event_id: ev, priority: "asap" });
    expect(last(b).out).toEqual(rejected("malformed"));
    b.createTask(bia, 1, { event_id: ev, tags: ["ok", ""] });
    expect(last(b).out).toEqual(rejected("malformed"));
    b.createTask(bia, 1, { event_id: ev, assignee: person("Zed").id });
    expect(last(b).out).toEqual(rejected("unknown_target"));
    b.createTask(bia, 1, { event_id: ev, assignee: caio.id, volunteers: [caio.id] });
    expect(last(b).out).toEqual(rejected("malformed"));
    b.createTask(bia, 1, { event_id: ev, attachments: [attachment(1, { size: TASK_LIMITS.attachmentBytes + 1 })] });
    expect(last(b).out).toEqual(rejected("malformed"));
    b.createTask(bia, 1, { event_id: ev, attachments: [attachment(1), attachment(1)] });
    expect(last(b).out).toEqual(rejected("malformed"));
    b.createTask(bia, 1, { event_id: ev });
    expect(last(b).out).toEqual(applied);
    b.createTask(bia, 1, { event_id: ev });
    expect(last(b).out).toEqual(rejected("already_exists"));
  });

  it("normalizes tags: trimmed, lowercased, unique, sorted", () => {
    const { b, bia, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, tags: [" Panfleto", "som", "SOM", "arte"] });
    expect(last(b).state.tasks![id]!.tags).toEqual(["arte", "panfleto", "som"]);
  });

  it("keeps attachments as given, in order", () => {
    const { b, bia, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, attachments: [attachment(2), attachment(1)] });
    const t = last(b).state.tasks![id]!;
    expect(t.attachments.map((a) => a.name)).toEqual(["foto-2.jpg", "foto-1.jpg"]);
    expect(t.attachments[0]).toEqual(attachment(2));
  });
});

describe("editing tasks", () => {
  it("the assignee may edit fields; helpers and bystanders may not", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id, volunteers: [davi.id] });
    b.op(davi, "task.update", { task_id: id, title: "Outro" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(caio, "task.update", { task_id: id, title: "Outro", description: "# Plano\n- [ ] som", due_at: 5, tags: ["som"] });
    expect(last(b).out).toEqual(applied);
    const t = last(b).state.tasks![id]!;
    expect(t.title).toBe("Outro");
    expect(t.description).toBe("# Plano\n- [ ] som");
    expect(t.due_at).toBe(5);
    expect(t.tags).toEqual(["som"]);
    b.op(caio, "task.update", { task_id: id, due_at: null, attachments: [attachment(1)] });
    expect(last(b).state.tasks![id]!.due_at).toBeUndefined();
    expect(last(b).state.tasks![id]!.attachments).toHaveLength(1);
  });

  it("only a manager of both scopes moves a task between an event and the community", () => {
    const { b, ana, bia, caio, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(caio, "task.update", { task_id: id, event_id: null });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "task.update", { task_id: id, event_id: null });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(ana, "task.update", { task_id: id, event_id: null });
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.tasks![id]!.event_id).toBeUndefined();
    // Now a community task: Bia no longer manages it.
    b.op(bia, "task.update", { task_id: id, title: "x" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(ana, "task.update", { task_id: id, event_id: ev });
    expect(last(b).out).toEqual(applied);
    b.op(bia, "task.update", { task_id: id, title: "x" });
    expect(last(b).out).toEqual(applied);
  });

  it("closed tasks are not edited; managers remove any task", () => {
    const { b, bia, caio, mila, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(bia, "task.status", { task_id: id, status: "cancelled" });
    b.op(bia, "task.update", { task_id: id, title: "x" });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(caio, "task.remove", { task_id: id });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(mila, "task.remove", { task_id: id, reason: "duplicada" });
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.tasks).toBeUndefined();
    b.op(mila, "task.remove", { task_id: id });
    expect(last(b).out).toEqual(rejected("unknown_target"));
  });
});

describe("assigning", () => {
  it("any member takes a task from the pool; nobody takes an assigned one", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev });
    b.op(caio, "task.assign", { task_id: id });
    expect(last(b).out).toEqual(applied);
    let t = last(b).state.tasks![id]!;
    expect(t.assignee).toBe(caio.id);
    expect(t.status).toBe("todo");
    b.op(davi, "task.assign", { task_id: id });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(caio, "task.assign", { task_id: id });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    // The manager reassigns; the old assignee is simply off the task.
    b.op(bia, "task.assign", { task_id: id, member_id: davi.id });
    expect(last(b).out).toEqual(applied);
    t = last(b).state.tasks![id]!;
    expect(t.assignee).toBe(davi.id);
    expect(t.volunteers).toEqual([]);
    expect(t.status).toBe("todo");
  });

  it("members cannot assign others; managers cannot assign non-members", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev });
    b.op(caio, "task.assign", { task_id: id, member_id: davi.id });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "task.assign", { task_id: id, member_id: person("Zed").id });
    expect(last(b).out).toEqual(rejected("unknown_target"));
  });

  it("assigning a helper promotes them out of the helper list", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id, volunteers: [davi.id] });
    b.op(bia, "task.assign", { task_id: id, member_id: davi.id });
    const t = last(b).state.tasks![id]!;
    expect(t.assignee).toBe(davi.id);
    expect(t.volunteers).toEqual([]);
  });

  it("unassigning sends the task back to the pool, with its history", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(caio, "task.status", { task_id: id, status: "in_progress" });
    b.op(davi, "task.unassign", { task_id: id });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(caio, "task.unassign", { task_id: id });
    expect(last(b).out).toEqual(applied);
    const t = last(b).state.tasks![id]!;
    expect(t.assignee).toBeUndefined();
    expect(t.status).toBe("awaiting_volunteer");
    expect(t.history.map((h) => h.status)).toEqual(["todo", "in_progress", "awaiting_volunteer"]);
    b.op(bia, "task.unassign", { task_id: id });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
  });

  it("helpers join and leave; managers add and remove them; the list is bounded", () => {
    const { b, ana, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(davi, "task.join", { task_id: id });
    expect(last(b).out).toEqual(applied);
    b.op(davi, "task.join", { task_id: id });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(caio, "task.join", { task_id: id });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(davi, "task.leave", { task_id: id, member_id: caio.id });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "task.leave", { task_id: id, member_id: davi.id });
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.tasks![id]!.volunteers).toEqual([]);
    const crowd = Array.from({ length: TASK_LIMITS.volunteers + 1 }, (_, i) => person(`V${i}`));
    for (const p of crowd) b.add(ana, p);
    for (const p of crowd) b.op(bia, "task.join", { task_id: id, member_id: p.id });
    expect(last(b).out).toEqual(rejected("capacity_full"));
    expect(last(b).state.tasks![id]!.volunteers).toHaveLength(TASK_LIMITS.volunteers);
  });
});

describe("status", () => {
  it("the people on the task move it; others do not", () => {
    const { b, bia, caio, davi, ev } = setup();
    const eva = person("Eva");
    b.add(b.founders[0]!, eva);
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id, volunteers: [davi.id] });
    b.op(eva, "task.status", { task_id: id, status: "in_progress" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(davi, "task.status", { task_id: id, status: "in_progress", note: "comecei pelo som" });
    expect(last(b).out).toEqual(applied);
    b.op(caio, "task.status", { task_id: id, status: "blocked" });
    expect(last(b).out).toEqual(applied);
    b.op(caio, "task.status", { task_id: id, status: "blocked" });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(caio, "task.status", { task_id: id, status: "done" });
    expect(last(b).out).toEqual(applied);
    const t = last(b).state.tasks![id]!;
    expect(t.closed_at).toBeDefined();
    expect(t.history.map((h) => [h.status, h.note])).toEqual([
      ["todo", undefined],
      ["in_progress", "comecei pelo som"],
      ["blocked", undefined],
      ["done", undefined],
    ]);
  });

  it("a task without an assignee cannot be in progress, and only a manager marks it done", () => {
    const { b, bia, caio, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev });
    b.op(bia, "task.status", { task_id: id, status: "in_progress" });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(caio, "task.status", { task_id: id, status: "done" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "task.status", { task_id: id, status: "done" });
    expect(last(b).out).toEqual(applied);
  });

  it("only managers cancel and reopen; reopening lands where the assignee situation says", () => {
    const { b, bia, caio, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(caio, "task.status", { task_id: id, status: "cancelled" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "task.status", { task_id: id, status: "cancelled", note: "a ação mudou" });
    expect(last(b).out).toEqual(applied);
    b.op(caio, "task.status", { task_id: id, status: "todo" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "task.status", { task_id: id, status: "awaiting_volunteer" });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(bia, "task.status", { task_id: id, status: "todo" });
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.tasks![id]!.closed_at).toBeUndefined();
    // Nobody goes back to the pool through task.status.
    b.op(bia, "task.status", { task_id: id, status: "awaiting_volunteer" });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    // Without an assignee, reopening lands in the pool.
    b.op(caio, "task.unassign", { task_id: id });
    b.op(bia, "task.status", { task_id: id, status: "done" });
    b.op(bia, "task.status", { task_id: id, status: "todo" });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(bia, "task.status", { task_id: id, status: "awaiting_volunteer" });
    expect(last(b).out).toEqual(applied);
  });

  it("keeps the last entries of a long history", () => {
    const { b, bia, caio, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    for (let i = 0; i < TASK_LIMITS.history; i++) {
      b.op(caio, "task.status", { task_id: id, status: i % 2 === 0 ? "in_progress" : "todo" });
    }
    const t = last(b).state.tasks![id]!;
    expect(t.history).toHaveLength(TASK_LIMITS.history);
    expect(t.history[0]!.status).toBe("in_progress");
    expect(t.history.at(-1)!.status).toBe("todo");
  });
});

describe("comments", () => {
  it("people on the task, its event's participants and managers comment; others do not", () => {
    const { b, bia, caio, davi, mila, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(davi, "task.comment", { task_id: id, comment_id: commentId(1), body: "oi" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.part(bia, "invite", ev, davi);
    b.part(davi, "accept", ev);
    b.op(davi, "task.comment", { task_id: id, comment_id: commentId(1), body: "oi" });
    expect(last(b).out).toEqual(applied);
    b.op(mila, "task.comment", { task_id: id, comment_id: commentId(2), body: "moderação aqui" });
    expect(last(b).out).toEqual(applied);
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(2), body: "dup" });
    expect(last(b).out).toEqual(rejected("already_exists"));
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(3), body: "" });
    expect(last(b).out).toEqual(rejected("malformed"));
    const t = last(b).state.tasks![id]!;
    expect(t.comments.map((c) => [c.author, c.body])).toEqual([
      [davi.id, "oi"],
      [mila.id, "moderação aqui"],
    ]);
  });

  it("anyone may comment on a task waiting for a volunteer", () => {
    const { b, bia, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev });
    b.op(davi, "task.comment", { task_id: id, comment_id: commentId(1), body: "posso pegar amanhã" });
    expect(last(b).out).toEqual(applied);
  });

  it("authors edit their own comments; authors and managers delete", () => {
    const { b, bia, caio, davi, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id, volunteers: [davi.id] });
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(1), body: "v1" });
    b.op(davi, "task.comment_edit", { task_id: id, comment_id: commentId(1), body: "v2" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "task.comment_edit", { task_id: id, comment_id: commentId(1), body: "v2" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    const edit = b.op(caio, "task.comment_edit", { task_id: id, comment_id: commentId(1), body: "v2" });
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.tasks![id]!.comments[0]).toMatchObject({ body: "v2", edited_seq: edit.seq });
    b.op(davi, "task.comment_delete", { task_id: id, comment_id: commentId(1) });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "task.comment_delete", { task_id: id, comment_id: commentId(1) });
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.tasks![id]!.comments).toEqual([]);
    b.op(caio, "task.comment_edit", { task_id: id, comment_id: commentId(1), body: "v3" });
    expect(last(b).out).toEqual(rejected("unknown_target"));
  });

  it("bounds the number of comments", () => {
    const { b, bia, caio, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    for (let i = 0; i < TASK_LIMITS.comments; i++) {
      b.op(caio, "task.comment", { task_id: id, comment_id: commentId(i), body: "x" });
    }
    b.op(caio, "task.comment", { task_id: id, comment_id: commentId(999), body: "x" });
    expect(last(b).out).toEqual(rejected("capacity_full"));
  });
});

describe("visibility helpers", () => {
  it("mirror the reducer's idea of who sees and who runs a task", () => {
    const { b, ana, bia, caio, davi, mila, ev } = setup();
    const pool = b.createTask(bia, 1, { event_id: ev });
    const mine = b.createTask(bia, 2, { event_id: ev, assignee: caio.id });
    const team = b.createTask(ana, 3, { assignee: ana.id });
    b.part(bia, "invite", ev, davi);
    b.part(davi, "accept", ev);
    const s = last(b).state;
    const m = (p: typeof ana) => s.members[p.id]!;
    const t = (id: string) => s.tasks![id]!;
    expect(canSeeTask(s, m(davi), t(pool))).toBe(true);
    expect(canSeeTask(s, m(davi), t(mine))).toBe(true); // confirmed at the event
    expect(canSeeTask(s, m(davi), t(team))).toBe(false);
    expect(canSeeTask(s, m(caio), t(mine))).toBe(true);
    expect(canSeeTask(s, m(caio), t(team))).toBe(false);
    expect(canSeeTask(s, m(mila), t(team))).toBe(true);
    expect(canManageTask(s, m(bia), t(mine))).toBe(true);
    expect(canManageTask(s, m(bia), t(team))).toBe(false);
    expect(canManageTask(s, m(ana), t(team))).toBe(true);
    expect(canManageTask(s, m(caio), t(mine))).toBe(false);
  });
});

describe("tasks follow their event and their people", () => {
  it("a member who leaves or is removed is taken off open tasks; closed ones keep history", () => {
    const { b, ana, bia, caio, davi, ev } = setup();
    const open = b.createTask(bia, 1, { event_id: ev, assignee: caio.id, volunteers: [davi.id] });
    const done = b.createTask(bia, 2, { event_id: ev, assignee: caio.id });
    b.op(caio, "task.status", { task_id: done, status: "done" });
    b.op(davi, "member.leave", {});
    expect(last(b).state.tasks![open]!.volunteers).toEqual([]);
    b.op(ana, "member.remove", { member_id: caio.id });
    const s = last(b).state;
    expect(s.tasks![open]!.assignee).toBeUndefined();
    expect(s.tasks![open]!.status).toBe("awaiting_volunteer");
    expect(s.tasks![open]!.history.at(-1)).toMatchObject({ status: "awaiting_volunteer", by: caio.id });
    expect(s.tasks![done]!.assignee).toBe(caio.id);
    expect(s.tasks![done]!.status).toBe("done");
  });

  it("an organizer who stops being one loses the event's tasks, not the ones assigned to them", () => {
    const { b, ana, bia, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: bia.id });
    b.op(ana, "member.role", { member_id: bia.id, role: "member" });
    b.op(bia, "task.assign", { task_id: id, member_id: ana.id });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "task.status", { task_id: id, status: "in_progress" });
    expect(last(b).out).toEqual(applied);
  });

  it("removing an event removes its tasks; summarizing it keeps them, managed by moderation only", () => {
    const { b, ana, bia, caio, mila, ev } = setup();
    const ev2 = b.createEvent(bia, 2);
    b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    const t2 = b.createTask(bia, 2, { event_id: ev2, assignee: caio.id });
    b.createTask(ana, 3);
    b.op(mila, "event.remove", { event_id: ev });
    let s = last(b).state;
    expect(Object.keys(s.tasks!).sort()).toEqual([taskId(2), taskId(3)].sort());

    b.op(bia, "event.complete", { event_id: ev2 });
    b.op(caio, "member.profile", { profile: { display_name: "c" } }, { at: b.at + 31 * DAY });
    s = last(b).state;
    expect(s.events[ev2]).toBeUndefined();
    expect(s.tasks![t2]!.event_id).toBe(ev2);
    b.op(bia, "task.update", { task_id: t2, title: "x" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(caio, "task.update", { task_id: t2, title: "x" });
    expect(last(b).out).toEqual(applied);
    b.op(mila, "task.update", { task_id: t2, title: "y" });
    expect(last(b).out).toEqual(applied);
    b.createTask(bia, 4, { event_id: ev2 });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.createTask(ana, 4, { event_id: ev2 });
    expect(last(b).out).toEqual(applied);
  });

  it("drops closed tasks after the detail window, by node time, honouring the policy", () => {
    const { b, ana, bia, caio, ev } = setup();
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    b.op(caio, "task.status", { task_id: id, status: "done" });
    const closedAt = b.at;
    b.op(caio, "member.profile", { profile: { display_name: "c" } }, { at: closedAt + 29 * DAY });
    expect(last(b).state.tasks![id]).toBeDefined();
    b.op(caio, "member.profile", { profile: { display_name: "c" } }, { at: closedAt + 30 * DAY });
    expect(last(b).state.tasks).toBeUndefined();

    const id2 = b.createTask(bia, 2, { event_id: ev, assignee: caio.id });
    b.op(ana, "policy.update", { policy: { ...DEFAULT_POLICY, retention: { ...DEFAULT_POLICY.retention, closed_task_detail_days: 2 } } });
    expect(last(b).out).toEqual(applied);
    b.op(bia, "task.status", { task_id: id2, status: "cancelled" });
    const cancelledAt = b.at;
    b.op(caio, "member.profile", { profile: { display_name: "c" } }, { at: cancelledAt + 2 * DAY });
    expect(last(b).state.tasks).toBeUndefined();
    b.op(ana, "policy.update", { policy: { ...DEFAULT_POLICY, retention: { ...DEFAULT_POLICY.retention, closed_task_detail_days: -1 } } });
    expect(last(b).out).toEqual(rejected("malformed"));
  });

  it("does not change the state hash of a community that never used tasks", () => {
    const { b, bia, caio, ev } = setup();
    const before = stateHash(last(b).state);
    const id = b.createTask(bia, 1, { event_id: ev, assignee: caio.id });
    expect(stateHash(last(b).state)).not.toBe(before);
    b.op(bia, "task.remove", { task_id: id });
    const s = last(b).state;
    expect(s.tasks).toBeUndefined();
    expect(canon(s, ["op_ids", "rejected_recent", "clock"])).toBe(canon(fold(b.entries.slice(0, -2)).state, ["op_ids", "rejected_recent", "clock"]));
    // And tasks survive a snapshot round trip.
    b.createTask(bia, 2, { event_id: ev, attachments: [attachment(1)], tags: ["som"] });
    const full = last(b).state;
    expect(canon(restoreSnapshot(createSnapshot(full)))).toBe(canon(full));
  });
});
