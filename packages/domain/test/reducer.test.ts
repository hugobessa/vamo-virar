import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../src/policy.js";
import { applyInPlace, fold, genesis, GenesisError, isAdmin, reduce, SequenceError } from "../src/reducer.js";
import type { Outcome, ParticipationStatus } from "../src/types.js";
import { clone } from "../src/util.js";
import { canon, DAY, eventId, key, LogBuilder, person, T0 } from "./helpers.js";

function last(b: LogBuilder): { state: ReturnType<typeof fold>["state"]; out: Outcome } {
  const r = fold(b.entries);
  return { state: r.state, out: r.outcomes.at(-1)! };
}

const rejected = (reason: string) => ({ status: "rejected", reason });
const applied = { status: "applied" };

function setup() {
  const ana = person("Ana");
  const bia = person("Bia"); // organizer
  const caio = person("Caio"); // member
  const davi = person("Davi"); // member
  const b = new LogBuilder([ana]);
  b.add(ana, bia, "organizer");
  b.add(ana, caio);
  b.add(ana, davi);
  return { b, ana, bia, caio, davi };
}

describe("genesis", () => {
  it("creates the community with founders as admins", () => {
    const { state } = last(new LogBuilder([person("Ana")]));
    const [m] = Object.values(state.members);
    expect(state.community.name).toBe("Coletivo Recife");
    expect(m!.role).toBe("admin");
    expect(isAdmin(state, m!)).toBe(true);
    expect(state.clock).toEqual({ seq: 1, now: T0 });
  });

  it("rejects a genesis whose founders do not match the admin set", () => {
    const b = new LogBuilder([person("Ana")]);
    const g = clone(b.entries[0]!);
    (g.control!.args as { admins: string[] }).admins.push(key(77));
    expect(() => genesis(g)).toThrow(GenesisError);
  });

  it("rejects an unreadable genesis and a non-CRK signer", () => {
    const b = new LogBuilder([person("Ana")]);
    expect(() => genesis({ ...b.entries[0]!, op: null })).toThrow(GenesisError);
    const g = clone(b.entries[0]!);
    g.control!.signer = key(9);
    expect(() => genesis(g)).toThrow(GenesisError);
  });

  it("rejects a second genesis as an op", () => {
    const ana = person("Ana");
    const b = new LogBuilder([ana]);
    b.entries.push({ ...clone(b.entries[0]!), seq: 2, opId: b.nextOpId() });
    expect(fold(b.entries).outcomes[1]).toEqual(rejected("illegal_transition"));
  });
});

describe("sequencing and bookkeeping", () => {
  it("requires contiguous seqs", () => {
    const { b } = setup();
    const { state } = fold(b.entries.slice(0, 2));
    expect(() => applyInPlace(state, b.entries[3]!)).toThrow(SequenceError);
  });

  it("ignores a duplicate op_id", () => {
    const { b, ana } = setup();
    const dup = b.add(ana, person("Eva"));
    const before = fold(b.entries).state;
    b.op(ana, "member.add", {}, { opId: dup.opId });
    const { state, out } = last(b);
    expect(out).toEqual({ status: "duplicate", seq: dup.seq });
    expect(canon(state, ["op_ids", "clock"])).toBe(canon(before, ["op_ids", "clock"]));
  });

  it("rejects unknown types without failing", () => {
    const { b, caio } = setup();
    b.op(caio, "chat.message", { text: "oi" });
    expect(last(b).out).toEqual(rejected("unknown_type"));
  });

  it("marks undecryptable data ops opaque", () => {
    const { b } = setup();
    b.opaque();
    expect(last(b).out).toEqual({ status: "opaque" });
  });

  it("records rejections for author feedback", () => {
    const { b, caio } = setup();
    const e = b.op(caio, "member.add", { msk: key(5), mek: key(6), profile: { display_name: "X" } });
    expect(last(b).state.rejected_recent.at(-1)).toMatchObject({ op_id: e.opId, reason: "not_authorized" });
  });

  it("reduce does not mutate its input", () => {
    const { b, ana } = setup();
    const { state } = fold(b.entries);
    const before = canon(state);
    const next = b.add(ana, person("Eva"));
    const r = reduce(state, next);
    expect(canon(state)).toBe(before);
    expect(r.outcome).toEqual(applied);
  });
});

describe("membership", () => {
  it("only admins add members", () => {
    const { b, bia } = setup();
    b.add(bia, person("Eva"));
    expect(last(b).out).toEqual(rejected("not_authorized"));
  });

  it("cannot add an admin directly", () => {
    const { b, ana } = setup();
    const p = person("Eva");
    b.op(ana, "member.add", { msk: p.msk, mek: p.mek, profile: { display_name: "Eva" }, role: "admin" });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
  });

  it("rejects adding an already-active member, allows re-adding a removed one", () => {
    const { b, ana, caio } = setup();
    b.add(ana, caio);
    expect(last(b).out).toEqual(rejected("already_exists"));
    b.op(ana, "member.remove", { member_id: caio.id });
    b.add(ana, caio);
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.members[caio.id]!.status).toBe("active");
  });

  it("organizers may remove plain members but not organizers", () => {
    const { b, ana, bia, caio } = setup();
    const fabi = person("Fabi");
    b.add(ana, fabi, "organizer");
    b.op(bia, "member.remove", { member_id: fabi.id });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(bia, "member.remove", { member_id: caio.id });
    expect(last(b).out).toEqual(applied);
  });

  it("removed members cannot act", () => {
    const { b, ana, caio } = setup();
    b.op(ana, "member.remove", { member_id: caio.id });
    b.op(caio, "member.profile", { profile: { display_name: "Caio 2" } });
    expect(last(b).out).toEqual(rejected("not_member"));
  });

  it("protects the last admin", () => {
    const { b, ana } = setup();
    b.op(ana, "member.leave", {});
    expect(last(b).out).toEqual(rejected("last_admin"));
    b.op(ana, "member.role", { member_id: ana.id, role: "member" });
    expect(last(b).out).toEqual(rejected("last_admin"));
  });

  it("admin power comes from the admin set; the role is a label", () => {
    const { b, ana, bia, caio } = setup();
    b.op(ana, "member.role", { member_id: caio.id, role: "admin" });
    let s = last(b).state;
    expect(isAdmin(s, s.members[caio.id]!)).toBe(false); // label only
    b.add(caio, person("Eva"));
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.adminSet(ana, [ana, bia]); // Bia is an organizer, not labelled admin
    s = last(b).state;
    expect(isAdmin(s, s.members[bia.id]!)).toBe(true);
    // Now Ana can leave.
    b.op(ana, "member.leave", {});
    expect(last(b).out).toEqual(applied);
  });

  it("CRK recovery: a member in the reset admin set can act as admin at once", () => {
    const { b, caio } = setup();
    b.adminSet(key(1), [caio]); // signed by the CRK
    const dave = person("Dave");
    b.add(caio, dave);
    expect(last(b).out).toEqual(applied);
  });

  it("removal withdraws open participations and organizer slots", () => {
    const { b, ana, bia, caio } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(caio, "volunteer", ev);
    b.op(ana, "member.remove", { member_id: bia.id });
    b.op(ana, "member.remove", { member_id: caio.id });
    const s = last(b).state;
    expect(s.events[ev]!.participations[caio.id]!.status).toBe("withdrawn");
    expect(s.events[ev]!.organizers).toEqual([]);
  });
});

describe("blocking", () => {
  it("only admins block; blocking removes the member and bars re-adding", () => {
    const { b, ana, bia, caio } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(caio, "volunteer", ev);
    b.op(bia, "member.block", { member_id: caio.id });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(ana, "member.block", { member_id: caio.id, reason: "assédio" });
    expect(last(b).out).toEqual(applied);
    let s = last(b).state;
    expect(s.members[caio.id]).toMatchObject({ status: "removed", blocked: true });
    expect(s.events[ev]!.participations[caio.id]!.status).toBe("withdrawn");
    b.op(caio, "member.profile", { profile: { display_name: "Caio 2" } });
    expect(last(b).out).toEqual(rejected("not_member"));
    b.add(ana, caio);
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(ana, "member.block", { member_id: caio.id });
    expect(last(b).out).toEqual(rejected("illegal_transition"));

    b.op(ana, "member.unblock", { member_id: caio.id });
    expect(last(b).out).toEqual(applied);
    s = last(b).state;
    expect(s.members[caio.id]!.blocked).toBeUndefined();
    expect(s.members[caio.id]!.status).toBe("removed");
    b.add(ana, caio);
    expect(last(b).out).toEqual(applied);
  });

  it("blocks former members, and rejects unknown targets and self-blocks", () => {
    const { b, ana, caio } = setup();
    b.op(caio, "member.leave", {});
    b.op(ana, "member.block", { member_id: caio.id });
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.members[caio.id]).toMatchObject({ status: "left", blocked: true });
    b.op(ana, "member.block", { member_id: person("Zé").id });
    expect(last(b).out).toEqual(rejected("unknown_target"));
    b.op(ana, "member.block", { member_id: ana.id });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(ana, "member.unblock", { member_id: ana.id });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
  });

  it("an admin blocking another admin keeps the last-admin rule", () => {
    const { b, ana, bia } = setup();
    b.adminSet(ana, [ana, bia]);
    b.op(bia, "member.block", { member_id: ana.id });
    expect(last(b).out).toEqual(applied);
    b.adminSet(bia, [bia]);
    expect(isAdmin(last(b).state, last(b).state.members[bia.id]!)).toBe(true);
  });
});

describe("control plane", () => {
  it("rotates epochs, signed by an admin only", () => {
    const { b, ana, caio } = setup();
    b.rotate(caio);
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.epoch = 0;
    b.rotate(ana);
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.epoch).toBe(1);
  });

  it("rejects a concurrent rotation to the same epoch", () => {
    const { b, ana } = setup();
    b.rotate(ana, { newEpoch: 1 });
    b.rotate(ana, { newEpoch: 1, epoch: 1 });
    expect(last(b).out).toEqual(rejected("epoch_conflict"));
  });

  it("accepts the previous epoch during the grace window but not older", () => {
    const { b, ana, caio } = setup();
    b.rotate(ana);
    b.op(caio, "member.profile", { profile: { display_name: "C" } }, { epoch: 0 });
    expect(last(b).out).toEqual(applied);
    b.rotate(ana, { epoch: 1 });
    b.op(caio, "member.profile", { profile: { display_name: "C" } }, { epoch: 0 });
    expect(last(b).out).toEqual(rejected("stale_epoch"));
  });

  it("a removed member's late op in the grace window is rejected", () => {
    const { b, ana, caio } = setup();
    b.op(ana, "member.remove", { member_id: caio.id });
    b.rotate(ana);
    b.op(caio, "member.profile", { profile: { display_name: "C" } }, { epoch: 0 });
    expect(last(b).out).toEqual(rejected("not_member"));
  });

  it("applies control headers even when the body is opaque", () => {
    const { b, ana } = setup();
    const e = b.rotate(ana);
    e.op = null;
    const { state, out } = last(b);
    expect(out).toEqual({ status: "opaque" });
    expect(state.epoch).toBe(1);
  });

  it("CRK can reset the admin set (recovery)", () => {
    const { b, bia } = setup();
    b.adminSet(key(1), [bia]);
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.admin_set).toEqual([bia.msk]);
  });

  it("migrate records where the community lives; members cannot move it; empty cancels", () => {
    const { b, ana, caio } = setup();
    const migrate = (signer: string, nodes: string[]) => b.migrate(signer, nodes);
    migrate(caio.msk, ["https://elsewhere.example"]);
    expect(last(b).out).toEqual(rejected("not_authorized"));
    migrate(ana.msk, ["ftp://node.example"]);
    expect(last(b).out).toEqual(rejected("malformed"));
    migrate(ana.msk, ["https://node-b.example"]);
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.community.nodes).toEqual(["https://node-b.example"]);
    migrate(ana.msk, []);
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.community.nodes).toBeUndefined();
  });
});

describe("events", () => {
  it("organizers create events; members cannot", () => {
    const { b, bia, caio } = setup();
    b.createEvent(caio, 1);
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.createEvent(bia, 1);
    expect(last(b).out).toEqual(applied);
    expect(last(b).state.events[eventId(1)]!.organizers).toEqual([bia.id]);
  });

  it("validates event fields", () => {
    const { b, bia } = setup();
    b.createEvent(bia, 1, { ends_at: T0 });
    expect(last(b).out).toEqual(rejected("malformed"));
    b.createEvent(bia, 2, { location: { label: "x", area: { lat_e4: 1.5, lng_e4: 0 } } });
    expect(last(b).out).toEqual(rejected("malformed"));
  });

  it("only the event's organizers or an admin manage it", () => {
    const { b, ana, bia } = setup();
    const fabi = person("Fabi");
    b.add(ana, fabi, "organizer");
    const ev = b.createEvent(bia, 1);
    b.op(fabi, "event.update", { event_id: ev, title: "Outro" });
    expect(last(b).out).toEqual(rejected("not_authorized"));
    b.op(ana, "event.update", { event_id: ev, title: "Outro" });
    expect(last(b).out).toEqual(applied);
  });

  it("changing time or place sends confirmed people to reconfirm", () => {
    const { b, bia, caio, davi } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(bia, "invite", ev, caio);
    b.part(caio, "accept", ev);
    b.part(bia, "invite", ev, davi);
    b.op(bia, "event.update", { event_id: ev, title: "Novo título" });
    expect(last(b).state.events[ev]!.participations[caio.id]!.status).toBe("confirmed");
    b.op(bia, "event.update", { event_id: ev, starts_at: T0 + 11 * 86_400_000, ends_at: T0 + 11 * 86_400_000 + 1 });
    const ps = last(b).state.events[ev]!.participations;
    expect(ps[caio.id]!.status).toBe("reconfirm");
    expect(ps[davi.id]!.status).toBe("invited");
  });

  it("records attendance only for confirmed participants of a completed event", () => {
    const { b, bia, caio, davi } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(bia, "invite", ev, caio);
    b.part(caio, "accept", ev);
    b.op(bia, "event.attendance", { event_id: ev, attended: [caio.id] });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(bia, "event.complete", { event_id: ev });
    b.op(bia, "event.attendance", { event_id: ev, attended: [caio.id, davi.id] });
    expect(last(b).out).toEqual(rejected("illegal_transition"));
    b.op(bia, "event.attendance", { event_id: ev, attended: [caio.id] });
    expect(last(b).out).toEqual(applied);
  });
});

describe("participation state machine", () => {
  type Action = "invite" | "volunteer" | "accept" | "decline" | "revoke" | "approve" | "reject" | "withdraw";
  const orgActions = new Set<Action>(["invite", "revoke", "approve", "reject"]);
  const legal: Record<Action, Partial<Record<ParticipationStatus | "none", ParticipationStatus>>> = {
    invite: { none: "invited", declined: "invited", withdrawn: "invited", not_selected: "invited", revoked: "invited" },
    volunteer: { none: "volunteered", withdrawn: "volunteered", declined: "volunteered" },
    accept: { invited: "confirmed", reconfirm: "confirmed" },
    decline: { invited: "declined", reconfirm: "withdrawn" },
    revoke: { invited: "revoked" },
    approve: { volunteered: "confirmed" },
    reject: { volunteered: "not_selected" },
    withdraw: { volunteered: "withdrawn", confirmed: "withdrawn", reconfirm: "withdrawn" },
  };
  const froms: (ParticipationStatus | "none")[] = [
    "none", "invited", "volunteered", "confirmed", "reconfirm", "declined", "withdrawn", "not_selected", "revoked",
  ];

  for (const action of Object.keys(legal) as Action[]) {
    for (const from of froms) {
      const to = legal[action][from];
      it(`${action} from ${from} → ${to ?? "illegal"}`, () => {
        const { b, bia, caio } = setup();
        const ev = b.createEvent(bia, 1);
        const { state } = fold(b.entries);
        if (from !== "none") state.events[ev]!.participations[caio.id] = { status: from, updated_seq: 1 };
        const e = orgActions.has(action) ? b.part(bia, action, ev, caio) : b.part(caio, action, ev);
        const r = reduce(state, e);
        if (to) {
          expect(r.outcome).toEqual(applied);
          expect(r.state.events[ev]!.participations[caio.id]!.status).toBe(to);
        } else {
          expect(r.outcome).toEqual(rejected("illegal_transition"));
        }
      });
    }
  }

  it("members cannot act on behalf of others", () => {
    const { b, bia, caio, davi } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(caio, "volunteer", ev, davi);
    expect(last(b).out).toEqual(rejected("not_authorized"));
  });

  it("members cannot invite", () => {
    const { b, bia, caio, davi } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(caio, "invite", ev, davi);
    expect(last(b).out).toEqual(rejected("not_authorized"));
  });

  it("auto volunteer mode confirms directly", () => {
    const ana = person("Ana");
    const caio = person("Caio");
    const b = new LogBuilder([ana], { ...DEFAULT_POLICY, volunteer_mode: "auto" });
    b.add(ana, caio);
    const ev = b.createEvent(ana, 1);
    b.part(caio, "volunteer", ev);
    expect(last(b).state.events[ev]!.participations[caio.id]!.status).toBe("confirmed");
  });

  it("nothing changes after an event closes", () => {
    const { b, bia, caio } = setup();
    const ev = b.createEvent(bia, 1);
    b.op(bia, "event.cancel", { event_id: ev });
    b.part(caio, "volunteer", ev);
    expect(last(b).out).toEqual(rejected("illegal_transition"));
  });
});

describe("conflict examples (protocol.md §9.4)", () => {
  it("accept on one device, decline on another: first wins", () => {
    const { b, bia, caio } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(bia, "invite", ev, caio);
    b.part(caio, "accept", ev);
    b.part(caio, "decline", ev);
    const { state, out } = last(b);
    expect(out).toEqual(rejected("illegal_transition"));
    expect(state.events[ev]!.participations[caio.id]!.status).toBe("confirmed");
  });

  it("cancel then accept", () => {
    const { b, bia, caio } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(bia, "invite", ev, caio);
    b.op(bia, "event.cancel", { event_id: ev });
    b.part(caio, "accept", ev);
    expect(last(b).out).toEqual(rejected("illegal_transition"));
  });

  it("two organizers invite the same person", () => {
    const { b, ana, bia, caio } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(bia, "invite", ev, caio);
    b.part(ana, "invite", ev, caio);
    expect(last(b).out).toEqual(rejected("illegal_transition"));
  });

  it("capacity: second acceptance is rejected", () => {
    const { b, bia, caio, davi } = setup();
    const ev = b.createEvent(bia, 1, { capacity: 1 });
    b.part(bia, "invite", ev, caio);
    b.part(bia, "invite", ev, davi);
    b.part(caio, "accept", ev);
    b.part(davi, "accept", ev);
    const { state, out } = last(b);
    expect(out).toEqual(rejected("capacity_full"));
    expect(state.events[ev]!.participations[davi.id]!.status).toBe("invited");
  });

  it("removed then accepts", () => {
    const { b, ana, bia, caio } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(bia, "invite", ev, caio);
    b.op(ana, "member.remove", { member_id: caio.id });
    b.part(caio, "accept", ev);
    expect(last(b).out).toEqual(rejected("not_member"));
  });
});

describe("policy", () => {
  it("refuses organizer-only participation in MVP", () => {
    const { b, ana } = setup();
    b.op(ana, "policy.update", { policy: { ...DEFAULT_POLICY, participation_visible: "organizers" } });
    expect(last(b).out).toEqual(rejected("unsupported"));
  });
});

describe("retention", () => {
  it("summarizes closed events after the detail window, by node time", () => {
    const { b, bia, caio } = setup();
    const ev = b.createEvent(bia, 1);
    b.part(bia, "invite", ev, caio);
    b.part(caio, "accept", ev);
    b.op(bia, "event.complete", { event_id: ev });
    b.op(bia, "event.attendance", { event_id: ev, attended: [caio.id] });
    const closedAt = b.at;

    b.op(caio, "member.profile", { profile: { display_name: "c" } }, { at: closedAt + 29 * DAY });
    expect(last(b).state.events[ev]).toBeDefined();

    b.op(caio, "member.profile", { profile: { display_name: "c" } }, { at: closedAt + 30 * DAY });
    const s = last(b).state;
    expect(s.events[ev]).toBeUndefined();
    expect(s.event_summaries[ev]).toEqual({
      event_id: ev,
      title: "Ato 1",
      starts_at: T0 + 10 * DAY,
      status: "completed",
      confirmed_count: 1,
      attended_count: 1,
    });
  });

  it("ignores author timestamps (a member cannot force early compaction)", () => {
    const { b, bia, caio } = setup();
    const ev = b.createEvent(bia, 1);
    b.op(bia, "event.cancel", { event_id: ev });
    const e = b.op(caio, "member.profile", { profile: { display_name: "c" } });
    e.op!.ts = T0 + 1000 * DAY;
    expect(last(b).state.events[ev]).toBeDefined();
  });

  it("strips removed members' profiles after the window", () => {
    const { b, ana, caio, davi } = setup();
    b.op(ana, "member.remove", { member_id: caio.id });
    b.op(davi, "member.profile", { profile: { display_name: "d" } }, { at: b.at + 31 * DAY });
    expect(last(b).state.members[caio.id]!.profile).toBeNull();
  });

  it("event ids in summaries cannot be reused", () => {
    const { b, bia } = setup();
    const ev = b.createEvent(bia, 1);
    b.op(bia, "event.cancel", { event_id: ev });
    b.op(bia, "member.profile", { profile: { display_name: "b" } }, { at: b.at + 31 * DAY });
    b.createEvent(bia, 1);
    expect(last(b).out).toEqual(rejected("already_exists"));
  });
});
