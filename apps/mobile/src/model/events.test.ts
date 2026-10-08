import { DEFAULT_POLICY, fold, reduce, memberIdOf, type CommunityState, type Entry, type ParticipationStatus } from "@vamo-virar/domain";
import { describe, expect, it } from "vitest";
import { orgActionsFor, selfActions, type OrgAction, type SelfAction } from "./events";

const hex = (n: number, bytes: number) => n.toString(16).padStart(2, "0").repeat(bytes);
const ana = { msk: hex(1, 32), mek: hex(2, 32) };
const bia = { msk: hex(3, 32), mek: hex(4, 32) };
const ev = hex(9, 16);

function log(capacity?: number): Entry[] {
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
      signer: hex(7, 32),
      args: { suite: "VV1", crk: hex(7, 32), admins: [ana.msk], eak: hex(8, 32), ik: hex(5, 32) },
    }),
    e(ana.msk, "member.add", { ...bia, profile: { display_name: "Bia" } }),
    e(ana.msk, "event.create", {
      event_id: ev,
      title: "x",
      starts_at: 10_000_000,
      ends_at: 20_000_000,
      tz: "UTC",
      location: { label: "l", area: { lat_e4: 0, lng_e4: 0 } },
      ...(capacity ? { capacity } : {}),
    }),
  ];
}

function base(capacity?: number): CommunityState {
  return fold(log(capacity)).state;
}

const ALL_SELF: SelfAction[] = ["volunteer", "accept", "decline", "withdraw"];
const ALL_ORG: OrgAction[] = ["invite", "revoke", "approve", "reject"];
const STATUSES: (ParticipationStatus | "none")[] = ["none", "invited", "volunteered", "confirmed", "reconfirm", "declined", "withdrawn", "not_selected", "revoked"];
const biaId = memberIdOf(bia.msk);

function attempt(state: CommunityState, author: string, type: string, body: unknown) {
  return reduce(state, { seq: state.clock.seq + 1, opId: hex(200, 16), epoch: 0, at: state.clock.now, op: { author, base: 0, ts: 0, type, body } }).outcome;
}

describe("the UI offers exactly the actions the reducer accepts", () => {
  for (const capacity of [undefined, 1]) {
    for (const from of STATUSES) {
      it(`from ${from}${capacity ? " (event full)" : ""}`, () => {
        const s = base(capacity);
        if (from !== "none") s.events[ev]!.participations[biaId] = { status: from, updated_seq: 1 };
        if (capacity) s.events[ev]!.participations[memberIdOf(ana.msk)] = { status: "confirmed", updated_seq: 1 };
        const me = s.members[biaId]!;
        const offered = new Set(selfActions(s, s.events[ev]!, me));
        for (const a of ALL_SELF) {
          const ok = attempt(s, bia.msk, `participation.${a}`, { event_id: ev }).status === "applied";
          expect(offered.has(a), `self ${a}`).toBe(ok);
        }
        const adminMe = s.members[memberIdOf(ana.msk)]!;
        const orgOffered = new Set(orgActionsFor(s, s.events[ev]!, adminMe, biaId));
        for (const a of ALL_ORG) {
          const ok = attempt(s, ana.msk, `participation.${a}`, { event_id: ev, member_id: biaId }).status === "applied";
          expect(orgOffered.has(a), `org ${a}`).toBe(ok);
        }
      });
    }
  }

  it("plain members get no organizer actions", () => {
    const s = base();
    expect(orgActionsFor(s, s.events[ev]!, s.members[biaId], memberIdOf(ana.msk))).toEqual([]);
  });
});
