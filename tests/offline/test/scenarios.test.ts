// Phase 8 (architecture.md §52): real-world offline and failure scenarios,
// against the real community-node binary (built with `test-clock` so days
// can pass in seconds) behind a fault-injecting proxy.
//
//   CARGO_TARGET_DIR=target/test-clock cargo build -p community-node --features test-clock
//   npm test -w @vamo-virar/offline-tests

import { isOrganizer } from "@vamo-virar/domain";
import { toHex } from "@vamo-virar/protocol";
import { parseInvite, Replica } from "@vamo-virar/sync";
import { afterEach, describe, expect, it } from "vitest";
import { canon, DAY_S, FaultProxy, HAVE_NODE, prng, retry, TestNode } from "./harness.js";

const DAY = DAY_S * 1000;
let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c().catch(() => undefined);
  cleanup = [];
});

async function setup(config: Record<string, number> = {}) {
  const node = await TestNode.start(config);
  const proxy = await FaultProxy.start(node.url);
  cleanup.push(() => node.destroy(), () => proxy.close());
  return { node, proxy };
}

const id = (n: number) => toHex(new Uint8Array(16).fill(n));
function eventBody(eventId: string, title: string, startsIn = 2 * DAY, extra: Record<string, unknown> = {}) {
  const start = Date.now() + startsIn;
  return {
    event_id: eventId,
    title,
    starts_at: start,
    ends_at: start + 3 * 3_600_000,
    tz: "America/Recife",
    location: { label: "Praça", area: { lat_e4: -80_571, lng_e4: -348_950 } },
    ...extra,
  };
}

async function admit(admin: Replica, applicant: Replica, role: "member" | "organizer" = "member") {
  const pending = await admin.joinRequests();
  const req = pending.find((p) => toHex(p.request.msk) === toHex(applicant.keys.signing.pk))!;
  expect((await admin.approve(req, role)).status).toBe("applied");
  await applicant.sync();
}

async function community(proxy: FaultProxy) {
  const ana = await Replica.found(proxy.client(), { name: "Coletivo", displayName: "Ana" });
  const bia = await Replica.join(proxy.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
  await admit(ana, bia, "organizer");
  const caio = await Replica.join(proxy.client(), parseInvite(ana.openInviteLink()), { displayName: "Caio" });
  await admit(ana, caio);
  for (const r of [ana, bia, caio]) await r.sync();
  return { ana, bia, caio };
}

async function settle(...rs: Replica[]) {
  for (let i = 0; i < 2; i++) for (const r of rs) await r.sync();
}

describe.skipIf(!HAVE_NODE)("offline scenarios", () => {
  for (const days of [1, 7, 30]) {
    it(`a member offline for ${days} day(s) comes back to the same state, and learns what failed`, async () => {
      const { node, proxy } = await setup();
      const { ana, bia, caio } = await community(proxy);
      const e1 = id(1);
      ana.submit("event.create", eventBody(e1, "Ato"));
      ana.submit("participation.invite", { event_id: e1, member_id: bia.memberId });
      await ana.sync();
      await bia.sync();
      bia.submit("participation.accept", { event_id: e1 });
      await bia.sync();
      await ana.sync();

      // Bia goes offline with two changes queued.
      bia.submit("member.profile", { profile: { display_name: "Bia (offline)" } });
      bia.submit("participation.withdraw", { event_id: e1 });

      // Life goes on without her: the event happens, someone is removed (new key), time passes.
      ana.submit("event.complete", { event_id: e1 });
      ana.submit("event.attendance", { event_id: e1, attended: [bia.memberId] });
      await ana.sync();
      await ana.removeMember(caio.memberId, "saiu"); // rotation + snapshot
      ana.submit("event.create", eventBody(id(2), "Depois", days * DAY + DAY));
      await ana.sync();
      await node.advance(days * DAY_S); // housekeeping: mailbox expiry, compaction at 30 days
      ana.submit("member.profile", { profile: { display_name: "Ana, dias depois" } });
      await ana.sync();

      const report = await bia.sync();
      await ana.sync();
      expect(bia.status).toBe("active");
      expect(bia.epoch).toBe(1);
      expect(bia.pending).toHaveLength(0);
      expect(canon(bia.canonical)).toBe(canon(ana.canonical));
      expect(bia.canonical!.members[bia.memberId]!.profile!.display_name).toBe("Bia (offline)");
      // Her withdrawal arrived after the event was over: rejected, and she is told.
      expect(report.rejected.map((r) => r.type)).toContain("participation.withdraw");
      if (days >= 30) {
        // Completed events older than the detail window are summaries now.
        expect(bia.canonical!.events[e1]).toBeUndefined();
        expect(bia.canonical!.event_summaries[e1]).toMatchObject({ status: "completed", attended_count: 1 });
      }
      await caio.sync();
      expect(caio.status).toBe("removed");
    });
  }

  it("the node goes down: everyone keeps working, then converges deterministically", async () => {
    const { proxy } = await setup();
    const { ana, bia, caio } = await community(proxy);
    const ev = id(3);
    ana.submit("event.create", eventBody(ev, "Uma vaga", 2 * DAY, { capacity: 1 }));
    ana.submit("participation.invite", { event_id: ev, member_id: bia.memberId });
    ana.submit("participation.invite", { event_id: ev, member_id: caio.memberId });
    await settle(ana, bia, caio);

    proxy.fault = { mode: "down" };
    bia.submit("participation.accept", { event_id: ev });
    caio.submit("participation.accept", { event_id: ev });
    ana.submit("event.update", { event_id: ev, title: "Uma vaga (atualizado)" });
    for (const r of [ana, bia, caio]) {
      await expect(r.sync()).rejects.toThrow();
      expect(r.pending).toHaveLength(1);
    }
    // Each sees their own change already.
    expect(bia.view!.events[ev]!.participations[bia.memberId]!.status).toBe("confirmed");
    expect(caio.view!.events[ev]!.participations[caio.memberId]!.status).toBe("confirmed");

    proxy.fault = { mode: "up" };
    await caio.sync(); // Caio reconnects first
    await settle(bia, ana, caio);
    for (const r of [bia, caio]) expect(canon(r.canonical)).toBe(canon(ana.canonical));
    const ps = ana.canonical!.events[ev]!.participations;
    expect(ps[caio.memberId]!.status).toBe("confirmed");
    expect(ps[bia.memberId]!.status).toBe("invited");
    expect(bia.ownOutcomes.at(-1)!.outcome).toEqual({ status: "rejected", reason: "capacity_full" });
    expect(ana.canonical!.events[ev]!.title).toBe("Uma vaga (atualizado)");
  });

  it("the node is destroyed: an admin rebuilds it and nobody loses anything", async () => {
    const { node, proxy } = await setup();
    const { ana, bia, caio } = await community(proxy);
    const ev = id(4);
    ana.submit("event.create", eventBody(ev, "Antes"));
    await ana.sync();
    await ana.makeSnapshot();
    bia.submit("member.profile", { profile: { display_name: "Bia antes" } });
    await settle(ana, bia, caio);
    const before = canon(ana.canonical);

    await node.destroy(); // machine and disk gone
    const fresh = await TestNode.start();
    cleanup.push(() => fresh.destroy());
    proxy.target = fresh.url; // same address, new machine

    await expect(bia.sync()).rejects.toThrow(); // the community is not there yet
    await ana.restoreTo(proxy.client());
    expect(canon(ana.canonical)).toBe(before);

    caio.submit("participation.volunteer", { event_id: ev });
    await settle(caio, bia, ana);
    expect(ana.canonical!.events[ev]!.participations[caio.memberId]!.status).toBe("volunteered");
    for (const r of [bia, caio]) expect(canon(r.canonical)).toBe(canon(ana.canonical));
  });

  it("a node that tampers with history is detected and changes nothing", async () => {
    const { proxy } = await setup();
    const { ana, bia } = await community(proxy);
    for (let i = 0; i < 5; i++) ana.submit("member.profile", { profile: { display_name: `Ana ${i}` } });
    await ana.sync();
    const before = canon(bia.canonical);
    const seqBefore = bia.canonical!.clock.seq;

    proxy.fault = {
      mode: "tamper",
      edit: (body) => {
        const entries = (body as { entries: { at: number }[] }).entries;
        if (entries.length > 1) entries[0]!.at += 3_600_000; // a different time for Bia
        return body;
      },
    };
    await expect(bia.sync()).rejects.toThrow(/chain/);
    expect(canon(bia.canonical)).toBe(before); // nothing from the tampered page was kept
    expect(bia.canonical!.clock.seq).toBe(seqBefore);

    proxy.fault = { mode: "up" };
    await bia.sync();
    expect(canon(bia.canonical)).toBe(canon(ana.canonical));
  });

  it("the admin is offline: the community keeps running; joining waits for them", async () => {
    const { proxy } = await setup();
    const { ana, bia, caio } = await community(proxy);
    // Ana is away. Bia (organizer) and Caio carry on.
    const ev = id(5);
    bia.submit("event.create", eventBody(ev, "Sem a Ana"));
    await bia.sync();
    await caio.sync();
    caio.submit("participation.volunteer", { event_id: ev });
    await caio.sync();
    await bia.sync();
    bia.submit("participation.approve", { event_id: ev, member_id: caio.memberId });
    await settle(bia, caio);
    expect(bia.canonical!.events[ev]!.participations[caio.memberId]!.status).toBe("confirmed");

    const dave = await Replica.join(proxy.client(), parseInvite(ana.openInviteLink()), { displayName: "Dave" });
    await dave.sync();
    expect(dave.status).toBe("joining");
    await expect(bia.joinRequests()).rejects.toThrow(/admins/);

    // Ana comes back.
    await ana.sync();
    await admit(ana, dave);
    await settle(ana, bia, caio, dave);
    expect(dave.status).toBe("active");
    for (const r of [bia, caio, dave]) expect(canon(r.canonical)).toBe(canon(ana.canonical));
  });

  it("every admin device is lost: the founder's recovery code restores an admin on a member's phone", async () => {
    const { proxy } = await setup();
    const { ana, bia, caio } = await community(proxy);
    const recoveryCode = ana.recoveryKey!;
    expect(recoveryCode).toHaveLength(32);
    const stolenPhone = ana; // Ana's phone is gone (and maybe in someone else's hands)

    await expect(caio.recoverAdmins(new Uint8Array(32).fill(7), [caio.memberId])).rejects.toThrow(/not for this community/);
    await bia.recoverAdmins(recoveryCode, [bia.memberId]);
    expect(bia.isAdmin).toBe(true);
    await caio.sync();
    expect(caio.canonical!.admin_set).toEqual([toHex(bia.keys.signing.pk)]);

    // Bia takes over: a new intake key (nobody holds the old one), and the lost phone is cut off.
    await bia.rotateIntakeKey();
    await bia.removeMember(stolenPhone.memberId, "celular perdido");
    const secret = id(6);
    bia.submit("event.create", eventBody(secret, "Depois da perda"));
    await settle(bia, caio);
    await stolenPhone.sync();
    expect(stolenPhone.status).toBe("removed");
    expect(stolenPhone.canonical!.events[secret]).toBeUndefined();

    // And the community can grow again.
    const eva = await Replica.join(proxy.client(), parseInvite(bia.openInviteLink()), { displayName: "Eva" });
    await admit(bia, eva);
    await settle(bia, caio, eva);
    expect(eva.status).toBe("active");
    expect(canon(eva.canonical)).toBe(canon(bia.canonical));
  });

  for (const seed of [1, 2, 3]) {
    it(`random concurrent changes while devices drop in and out converge (seed ${seed})`, async () => {
      const { proxy } = await setup();
      const { ana, bia, caio } = await community(proxy);
      const devices = [ana, bia, caio];
      const events = [id(10), id(11)];
      ana.submit("event.create", eventBody(events[0]!, "Cap 1", 2 * DAY, { capacity: 1 }));
      ana.submit("event.create", eventBody(events[1]!, "Cap 2", 3 * DAY, { capacity: 2 }));
      await settle(...devices);

      const rnd = prng(seed);
      const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
      const self = ["volunteer", "accept", "decline", "withdraw"] as const;
      const org = ["invite", "approve", "reject", "revoke"] as const;
      for (let round = 0; round < 30; round++) {
        for (const d of devices) {
          const state = d.view!;
          const me = state.members[d.memberId]!;
          const ev = pick(events);
          if (isOrganizer(state, me) && rnd() < 0.5) {
            const target = pick(devices.filter((x) => x !== d));
            d.submit(`participation.${pick(org)}`, { event_id: ev, member_id: target.memberId });
          } else if (rnd() < 0.1 && isOrganizer(state, me)) {
            d.submit("event.update", { event_id: ev, starts_at: Date.now() + (2 + round) * DAY, ends_at: Date.now() + (2 + round) * DAY + 3_600_000 });
          } else {
            d.submit(`participation.${pick(self)}`, { event_id: ev });
          }
          if (rnd() < 0.5) await d.sync(); // only some are online this round
        }
      }
      await settle(...devices);
      for (const d of devices) {
        expect(d.pending).toHaveLength(0);
        expect(canon(d.canonical)).toBe(canon(ana.canonical));
      }
      const s = ana.canonical!;
      for (const e of Object.values(s.events)) {
        const confirmed = Object.entries(e.participations).filter(([, p]) => p.status === "confirmed");
        expect(confirmed.length).toBeLessThanOrEqual(e.capacity ?? Infinity);
        // Nobody is confirmed without having said yes themselves.
        for (const [memberId] of confirmed) {
          const who = devices.find((d) => d.memberId === memberId)!;
          const saidYes = who.ownOutcomes.some(
            (o) => (o.type === "participation.accept" || o.type === "participation.volunteer") && o.outcome.status === "applied",
          );
          expect(saidYes).toBe(true);
        }
      }
    });
  }

  it("a connection that keeps dropping loses nothing and duplicates nothing", async () => {
    const { proxy } = await setup();
    const { ana, bia, caio } = await community(proxy);
    const devices = [ana, bia, caio];
    proxy.fault = { mode: "flaky", before: 0.25, after: 0.25, rng: prng(42) };
    let n = 0;
    for (let round = 0; round < 10; round++) {
      for (const d of devices) {
        if (d === caio) {
          d.submit("member.profile", { profile: { display_name: `Caio ${round}` } });
        } else {
          d.submit("event.create", eventBody(id(100 + n++), `Evento ${n}`));
        }
        await d.sync().catch(() => undefined); // most syncs fail somewhere
      }
    }
    expect(proxy.stats.failedBefore + proxy.stats.droppedAfter).toBeGreaterThan(5);
    proxy.fault = { mode: "up" };
    for (const d of devices) await retry(() => d.sync());
    await settle(...devices);

    for (const d of devices) {
      expect(d.pending).toHaveLength(0);
      expect(canon(d.canonical)).toBe(canon(ana.canonical));
    }
    expect(Object.keys(ana.canonical!.events)).toHaveLength(20);
    for (const d of devices) {
      const ids = d.ownOutcomes.map((o) => o.opId);
      expect(new Set(ids).size).toBe(ids.length); // each op sequenced once
    }
    expect(ana.canonical!.members[caio.memberId]!.profile!.display_name).toBe("Caio 9");
  });
});
