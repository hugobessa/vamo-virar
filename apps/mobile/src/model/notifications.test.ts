// The notices list is read off the state: mentions of this person, tasks
// handed to them, invitations; nothing they did themselves, nothing they
// cannot see.

import { DEFAULT_POLICY, fold, memberIdOf, type Entry } from "@vamo-virar/domain";
import { describe, expect, it } from "vitest";
import { latestSeq, noticesFor, noticeSubject, unreadNotices } from "./notifications";

const hex = (n: number, bytes: number) => n.toString(16).padStart(2, "0").repeat(bytes);
const ana = { msk: hex(1, 32), mek: hex(2, 32) }; // admin
const bia = { msk: hex(3, 32), mek: hex(4, 32) }; // organizer
const caio = { msk: hex(5, 32), mek: hex(6, 32) }; // member
const ev = hex(9, 16);
const T1 = hex(10, 16);
const T2 = hex(11, 16);
const C1 = hex(12, 16);
const C2 = hex(13, 16);
const id = (p: { msk: string }) => memberIdOf(p.msk);

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
    e(ana.msk, "member.add", { ...bia, profile: { display_name: "Bia" }, role: "organizer" }), // 2
    e(ana.msk, "member.add", { ...caio, profile: { display_name: "Caio" } }), // 3
    e(bia.msk, "event.create", { event_id: ev, title: "Panfletagem", starts_at: 10_000_000, ends_at: 20_000_000, tz: "UTC", location: { label: "l", area: { lat_e4: 0, lng_e4: 0 } } }), // 4
    e(bia.msk, "participation.invite", { event_id: ev, member_id: id(caio) }), // 5
    e(bia.msk, "task.create", { task_id: T1, event_id: ev, title: "Levar o som", assignee: id(caio) }), // 6
    e(bia.msk, "task.comment", { task_id: T1, comment_id: C1, body: "@Caio @Ana", mentions: [id(caio), id(ana)].sort() }), // 7
    e(caio.msk, "task.comment", { task_id: T1, comment_id: C2, body: "@Bia ok", mentions: [id(bia)] }), // 8
    // A pool task Caio takes himself: not a notice for him.
    e(ana.msk, "task.create", { task_id: T2, title: "Cartazes" }), // 9
    e(caio.msk, "task.assign", { task_id: T2 }), // 10
  ];
}

describe("noticesFor", () => {
  const { state } = fold(log());
  const me = (p: { msk: string }) => state.members[id(p)];

  it("lists mentions, handovers and invitations addressed to the person, newest first", () => {
    const n = noticesFor(state, me(caio));
    expect(n.map((x) => [x.kind, x.seq, x.by])).toEqual([
      ["mention", 7, id(bia)],
      ["assigned", 6, id(bia)],
      ["invited", 5, id(bia)],
    ]);
    expect(n.map(noticeSubject)).toEqual(["Levar o som", "Levar o som", "Panfletagem"]);
    expect(latestSeq(n)).toBe(7);
  });

  it("skips what the person did themselves and what they cannot see", () => {
    expect(noticesFor(state, me(bia)).map((x) => [x.kind, x.seq])).toEqual([["mention", 8]]);
    // Ana manages everything, so she sees the mention; she invited nobody and took nothing.
    expect(noticesFor(state, me(ana)).map((x) => [x.kind, x.seq])).toEqual([["mention", 7]]);
    expect(noticesFor(state, undefined)).toEqual([]);
  });

  it("counts as unread only past the seen mark", () => {
    expect(unreadNotices(state, me(caio), { seen: 0, notified: 0 })).toHaveLength(3);
    expect(unreadNotices(state, me(caio), { seen: 6, notified: 6 }).map((x) => x.kind)).toEqual(["mention"]);
    expect(unreadNotices(null, me(caio), { seen: 0, notified: 0 })).toEqual([]);
  });

  it("an accepted invitation, or a task given back, leaves the list", () => {
    const more = log();
    const e = (author: string, type: string, body: unknown): Entry => ({ seq: more.length + 1, opId: hex(more.length + 1, 16), epoch: 0, at: 0, op: { author, base: 0, ts: 0, type, body } });
    more.push(e(caio.msk, "participation.accept", { event_id: ev }));
    more.push(e(caio.msk, "task.unassign", { task_id: T1 }));
    const { state: later } = fold(more);
    expect(noticesFor(later, later.members[id(caio)]).map((x) => x.kind)).toEqual(["mention"]);
  });
});
