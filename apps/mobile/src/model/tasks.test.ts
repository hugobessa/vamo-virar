// The task view model offers exactly what the reducer accepts, for every
// status and every kind of person: manager, assignee, helper, participant
// of the event, bystander.

import { DEFAULT_POLICY, fold, memberIdOf, reduce, type CommunityState, type Entry, type Task, type TaskStatus } from "@vamo-virar/domain";
import { describe, expect, it } from "vitest";
import { allTags, byStatus, parseTagInput, selfActions, statusTargets, timeline, visibleTasks, type SelfAction } from "./tasks";

const hex = (n: number, bytes: number) => n.toString(16).padStart(2, "0").repeat(bytes);
const ana = { msk: hex(1, 32), mek: hex(2, 32) }; // admin
const bia = { msk: hex(3, 32), mek: hex(4, 32) }; // organizer of the event
const caio = { msk: hex(5, 32), mek: hex(6, 32) }; // member
const duda = { msk: hex(7, 32), mek: hex(8, 32) }; // member, confirmed at the event
const ev = hex(9, 16);
const TASK = hex(10, 16);
const PEOPLE = { ana, bia, caio, duda };
type Who = keyof typeof PEOPLE;
const id = (w: Who) => memberIdOf(PEOPLE[w].msk);

function log(): Entry[] {
  let seq = 0;
  const e = (author: string, type: string, body: unknown, control?: Entry["control"]): Entry => {
    seq++;
    const entry: Entry = { seq, opId: hex(seq, 16), epoch: 0, at: 1_000 * seq, op: { author, base: 0, ts: 0, type, body } };
    if (control) entry.control = control;
    return entry;
  };
  return [
    e(ana.msk, "community.init", { name: "c", description: "", policy: DEFAULT_POLICY, founders: [{ ...ana, profile: { display_name: "Ana" } }] }, {
      kind: "genesis",
      signer: hex(11, 32),
      args: { suite: "VV1", crk: hex(11, 32), admins: [ana.msk], eak: hex(12, 32), ik: hex(13, 32) },
    }),
    e(ana.msk, "member.add", { ...bia, profile: { display_name: "Bia" }, role: "organizer" }),
    e(ana.msk, "member.add", { ...caio, profile: { display_name: "Caio" } }),
    e(ana.msk, "member.add", { ...duda, profile: { display_name: "Duda" } }),
    e(bia.msk, "event.create", { event_id: ev, title: "x", starts_at: 10_000_000, ends_at: 20_000_000, tz: "UTC", location: { label: "l", area: { lat_e4: 0, lng_e4: 0 } } }),
    e(bia.msk, "participation.invite", { event_id: ev, member_id: id("duda") }),
    e(duda.msk, "participation.accept", { event_id: ev }),
    e(bia.msk, "task.create", { task_id: TASK, event_id: ev, title: "Levar o som", tags: ["som"] }),
  ];
}

function attempt(state: CommunityState, author: string, type: string, body: unknown) {
  return reduce(state, { seq: state.clock.seq + 1, opId: hex(200, 16), epoch: 0, at: state.clock.now, op: { author, base: 0, ts: 0, type, body } }).outcome;
}

const STATUSES: TaskStatus[] = ["awaiting_volunteer", "todo", "in_progress", "blocked", "done", "cancelled"];
const ALL_SELF: SelfAction[] = ["take", "unassign", "join", "leave"];
const OP: Record<SelfAction, string> = { take: "task.assign", unassign: "task.unassign", join: "task.join", leave: "task.leave" };

/** The base state with the task forced into `status`, `assignee` and `volunteers`. */
function withTask(status: TaskStatus, assignee?: Who, volunteers: Who[] = []): CommunityState {
  const s = fold(log()).state;
  const t = s.tasks![TASK]!;
  t.status = status;
  if (assignee) t.assignee = id(assignee);
  t.volunteers = volunteers.map(id).sort();
  if (status === "done" || status === "cancelled") t.closed_at = s.clock.now;
  return s;
}

describe("the UI offers exactly the actions the reducer accepts", () => {
  const shapes: { status: TaskStatus; assignee?: Who; volunteers?: Who[] }[] = [];
  for (const status of STATUSES) {
    if (status === "awaiting_volunteer") shapes.push({ status }, { status, volunteers: ["caio"] });
    else shapes.push({ status, assignee: "caio" }, { status, assignee: "caio", volunteers: ["duda"] }, { status, assignee: "bia" });
  }
  for (const shape of shapes) {
    for (const who of Object.keys(PEOPLE) as Who[]) {
      it(`${shape.status} assigned to ${shape.assignee ?? "nobody"} with ${shape.volunteers?.join(",") ?? "no"} helpers, as ${who}`, () => {
        const s = withTask(shape.status, shape.assignee, shape.volunteers);
        const task = s.tasks![TASK]!;
        const me = s.members[id(who)]!;
        const offered = new Set(selfActions(s, task, me));
        for (const a of ALL_SELF) {
          const ok = attempt(s, PEOPLE[who].msk, OP[a], { task_id: TASK }).status === "applied";
          expect(offered.has(a), `self ${a}`).toBe(ok);
        }
        const targets = new Set(statusTargets(s, task, me));
        for (const to of STATUSES) {
          const ok = attempt(s, PEOPLE[who].msk, "task.status", { task_id: TASK, status: to }).status === "applied";
          expect(targets.has(to), `status → ${to}`).toBe(ok);
        }
      });
    }
  }
});

describe("the board", () => {
  it("shows each person what they may see, filtered", () => {
    const s = fold(log()).state;
    const second = hex(14, 16);
    const t2: Task = { ...s.tasks![TASK]!, task_id: second, event_id: undefined, status: "todo", assignee: id("ana"), tags: ["arte", "som"], updated_seq: 99 };
    delete t2.event_id;
    s.tasks![second] = t2;
    expect(visibleTasks(s, s.members[id("caio")]).map((t) => t.task_id)).toEqual([TASK]); // the pool only
    expect(visibleTasks(s, s.members[id("ana")]).map((t) => t.task_id)).toEqual([second, TASK]);
    expect(visibleTasks(s, s.members[id("ana")], { scope: "community" }).map((t) => t.task_id)).toEqual([second]);
    expect(visibleTasks(s, s.members[id("ana")], { scope: ev }).map((t) => t.task_id)).toEqual([TASK]);
    expect(visibleTasks(s, s.members[id("ana")], { tag: "arte" }).map((t) => t.task_id)).toEqual([second]);
    expect(visibleTasks(s, s.members[id("ana")], { mine: true }).map((t) => t.task_id)).toEqual([second]);
    expect(byStatus(visibleTasks(s, s.members[id("ana")])).map((g) => [g.status, g.tasks.length])).toEqual([["awaiting_volunteer", 1], ["todo", 1]]);
    expect(allTags(s)).toEqual(["som", "arte"]);
  });

  it("merges comments and status changes by seq", () => {
    const s = fold(log()).state;
    const t = s.tasks![TASK]!;
    t.comments.push({ comment_id: hex(15, 16), author: id("caio"), body: "posso", seq: 12 });
    t.history.push({ status: "todo", by: id("caio"), seq: 10 });
    expect(timeline(t).map((i) => [i.kind, i.seq])).toEqual([["status", 8], ["status", 10], ["comment", 12]]);
  });

  it("cleans typed tags like the reducer", () => {
    expect(parseTagInput(" Som, arte ,SOM\n,,")).toEqual(["arte", "som"]);
  });
});
