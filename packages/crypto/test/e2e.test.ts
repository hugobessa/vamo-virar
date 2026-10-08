// End-to-end: founder, joins via intake, events, removal + rotation, a new
// member bootstrapping from a snapshot, a long-offline device, and a stolen
// node database. Domain + crypto + a node that implements only §4.1/§5.

import { isAdmin } from "@vamo-virar/domain";
import { toHex, utf8 } from "@vamo-virar/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { entryHash, IntegrityError, LogVerifier, openOp } from "../src/envelope.js";
import { openJoinRequest } from "../src/intake.js";
import { openKeyEnvelope, sealKeyEnvelope } from "../src/keyenv.js";
import { mailboxId, memberId, type EpochKeys } from "../src/keys.js";
import { rotateEpoch } from "../src/rotation.js";
import { openSnapshot, sealSnapshot } from "../src/snapshot.js";
import { canonState } from "./canon.js";
import { Device, foundCommunity } from "./device.js";
import { contains, seededRng } from "./helpers.js";
import { MockNode } from "./mock-node.js";

const EVENT_1 = "Ato na Praça do Derby";
const EVENT_2 = "Reunião secreta da coordenação";
const DAY10 = Date.UTC(2026, 9, 11);

describe("end to end", () => {
  const rng = seededRng("e2e");
  const { founder: ana, node, k0 } = foundCommunity("Ana Founder", rng, (cid) => new MockNode(cid));
  const cid = ana.cid;
  const bia = new Device("Bia Organizadora", cid, rng);
  const caio = new Device("Caio Removido", cid, rng);
  let k1: EpochKeys;
  let ev1: string;

  /** Admin side of §10.2: open intake, add member, deliver the current key. */
  function approveAll(): void {
    for (const sealed of node.intake.splice(0)) {
      const req = openJoinRequest(sealed, cid, ana.ik!);
      expect(req).not.toBeNull();
      const add = ana.write(node, "member.add", { msk: toHex(req!.msk), mek: toHex(req!.mek), profile: req!.profile });
      expect(add.ok).toBe(true);
      const current = ana.keyring.latest()!;
      node.post(mailboxId(cid, req!.msk), sealKeyEnvelope(cid, current.epoch, current.key, req!.mek, { rng }));
    }
    ana.sync(node);
  }

  beforeAll(() => {
    bia.requestToJoin(node, ana.ik!.pk);
    caio.requestToJoin(node, ana.ik!.pk);
    approveAll();
    for (const d of [bia, caio]) {
      d.checkMail(node);
      d.sync(node);
    }

    expect(ana.write(node, "member.role", { member_id: bia.id, role: "organizer" }).ok).toBe(true);
    bia.sync(node);
    ev1 = toHex(rng(16));
    expect(
      bia.write(node, "event.create", {
        event_id: ev1,
        title: EVENT_1,
        starts_at: DAY10,
        ends_at: DAY10 + 3 * 3_600_000,
        tz: "America/Recife",
        location: { label: "Praça do Derby", area: { lat_e4: -80_571, lng_e4: -348_950 } },
      }).ok,
    ).toBe(true);
    caio.sync(node);
    expect(caio.write(node, "participation.volunteer", { event_id: ev1 }).ok).toBe(true);
    bia.sync(node);
    expect(bia.write(node, "participation.approve", { event_id: ev1, member_id: caio.id }).ok).toBe(true);

    // Remove Caio, then rotate to epoch 1 for Ana and Bia only (§7.3).
    ana.sync(node);
    expect(ana.write(node, "member.remove", { member_id: caio.id, reason: "test" }).ok).toBe(true);
    ana.sync(node);
    const rot = rotateEpoch({
      cid,
      current: ana.keyring.latest()!,
      admin: ana.keys.signing,
      recipients: [ana.keys.encryption.pk, bia.keys.encryption.pk],
      body: { reason: "member removed", removed: [caio.id] },
      opId: rng(16),
      base: ana.verifier.seq,
      ts: 0,
      rng,
    });
    expect(node.submit(rot.op).ok).toBe(true);
    node.post(ana.mailbox, rot.keyEnvelopes[0]!);
    node.post(bia.mailbox, rot.keyEnvelopes[1]!);
    k1 = rot.next;

    for (const d of [ana, bia]) {
      d.checkMail(node);
      d.sync(node);
    }
    expect(
      bia.write(node, "event.create", {
        event_id: toHex(rng(16)),
        title: EVENT_2,
        starts_at: DAY10,
        ends_at: DAY10 + 3_600_000,
        tz: "America/Recife",
        location: { label: "Sede", area: { lat_e4: -80_500, lng_e4: -348_900 } },
      }).ok,
    ).toBe(true);
    for (const d of [ana, bia, caio]) {
      d.checkMail(node);
      d.sync(node);
    }
  });

  it("every op was applied on the devices that can read it", () => {
    expect(ana.outcomes.every((o) => o.status === "applied")).toBe(true);
    expect(ana.state!.epoch).toBe(1);
  });

  it("remaining members converge, including content from the new epoch", () => {
    expect(canonState(bia.state!)).toBe(canonState(ana.state!));
    const titles = Object.values(ana.state!.events).map((e) => e.title);
    expect(titles).toEqual(expect.arrayContaining([EVENT_1, EVENT_2]));
    expect(ana.state!.events[ev1]!.participations[caio.id]!.status).toBe("withdrawn");
  });

  it("the removed member cannot read anything after the rotation", () => {
    expect(caio.keyring.get(1)).toBeUndefined();
    expect(caio.state!.members[caio.id]!.status).toBe("removed");
    const titles = Object.values(caio.state!.events).map((e) => e.title);
    expect(titles).not.toContain(EVENT_2);
    expect(caio.outcomes.at(-1)).toEqual({ status: "opaque" });
    // Not even with someone else's key envelope.
    for (const env of [...node.read(ana.mailbox), ...node.read(bia.mailbox)]) {
      expect(openKeyEnvelope(env, caio.keys.encryption)).toBeNull();
    }
  });

  it("the removed member's late write is accepted in the grace window but rejected by every reducer", () => {
    const res = caio.write(node, "member.profile", { profile: { display_name: "still here" } }, ana.keyring.get(0));
    expect(res.ok).toBe(true);
    for (const d of [ana, bia]) d.sync(node);
    expect(ana.outcomes.at(-1)).toEqual({ status: "rejected", reason: "not_member" });
    expect(bia.outcomes.at(-1)).toEqual({ status: "rejected", reason: "not_member" });

    node.graceOpen = false;
    expect(caio.write(node, "member.profile", { profile: { display_name: "x" } }, ana.keyring.get(0))).toEqual({
      ok: false,
      error: "epoch_stale",
    });
    // And the old epoch's access key gets nothing under the new epoch.
    const forged = { ...k1, access: k0.access };
    expect(caio.write(node, "member.profile", { profile: { display_name: "x" } }, forged)).toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it("a stolen node database reveals no names, event content or keys", () => {
    const db = node.dump();
    const secrets = [
      utf8(EVENT_1),
      utf8(EVENT_2),
      utf8("Praça do Derby"),
      utf8("Bia Organizadora"),
      utf8("Caio Removido"),
      utf8("Ana Founder"),
      k0.key,
      k1.key,
      k0.opKey,
      k1.opKey,
      k1.access.sk,
      ana.ik!.sk,
      ana.keys.signing.sk,
      ana.keys.encryption.sk,
      bia.keys.encryption.sk,
      // Member ids are hashes of keys the node never sees for non-admins.
      memberId(bia.keys.signing.pk),
    ];
    for (const s of secrets) expect(contains(db, s)).toBe(false);
    // Positive control: the search would find something that is there.
    expect(contains(db, cid)).toBe(true);
  });

  it("a new member bootstraps from a snapshot and cannot read history before it", () => {
    ana.sync(node);
    const snap = sealSnapshot({
      cid,
      head: ana.verifier.head,
      state: ana.state!,
      epoch: ana.keyring.latest()!,
      author: ana.keys.signing,
      rng,
    });
    expect(node.putSnapshot(snap)).toBe(true);

    const davi = new Device("Davi Novo", cid, rng);
    davi.requestToJoin(node, ana.ik!.pk);
    approveAll();
    davi.checkMail(node);
    expect(davi.keyring.get(1)).toBeDefined();

    const opened = openSnapshot(node.snapshot!, davi.keyring.get(1)!);
    expect(opened).not.toBeNull();
    // The snapshot's author must be an admin at that point (caller's check).
    const author = Object.values(opened!.state.members).find((m) => m.msk === toHex(opened!.author))!;
    expect(isAdmin({ ...opened!.state, op_ids: {} }, author)).toBe(true);

    davi.restore(opened!);
    davi.sync(node);
    ana.sync(node);
    expect(canonState(davi.state!)).toBe(canonState(ana.state!));
    expect(Object.values(davi.state!.events).map((e) => e.title)).toContain(EVENT_1);

    // History before the snapshot stays sealed under K0, which Davi never got.
    expect(openOp(node.log[0]!.env, davi.keyring.get(0)).ok).toBe(false);
    expect(davi.keyring.get(0)).toBeUndefined();

    // A tampered snapshot is refused.
    const bad = { ...node.snapshot!, ct: node.snapshot!.ct.slice() };
    bad.ct[10]! ^= 1;
    expect(openSnapshot(bad, davi.keyring.get(1)!)).toBeNull();
    expect(openSnapshot({ ...node.snapshot!, seq: node.snapshot!.seq + 1 }, davi.keyring.get(1)!)).toBeNull();
  });

  it("a device offline for 200 operations catches up to the same state", () => {
    for (let i = 0; i < 200; i++) {
      expect(ana.write(node, "member.profile", { profile: { display_name: `Ana ${i}` } }).ok).toBe(true);
    }
    ana.sync(node);
    bia.sync(node);
    expect(bia.verifier.seq).toBe(node.log.length);
    expect(canonState(bia.state!)).toBe(canonState(ana.state!));
  });

  it("devices detect a node that rewrites history", () => {
    const fresh = new LogVerifier(cid, ana.keyring);
    const log = node.log.map((e) => ({ ...e }));
    log[3] = { ...log[3]!, at: log[3]!.at + 1 }; // a different retention clock for this device
    fresh.ingest(log[0]!);
    fresh.ingest(log[1]!);
    fresh.ingest(log[2]!);
    fresh.ingest(log[3]!); // accepted on its own…
    expect(() => fresh.ingest(log[4]!)).toThrow(IntegrityError); // …but the chain no longer links

    const reordered = new LogVerifier(cid, ana.keyring);
    reordered.ingest(node.log[0]!);
    expect(() => reordered.ingest(node.log[2]!)).toThrow(IntegrityError);

    const forged = new LogVerifier(cid, ana.keyring);
    forged.ingest(node.log[0]!);
    const e = node.log[1]!;
    const tampered = { ...e, env: { ...e.env, asig: e.env.asig.map((b, i) => (i === 0 ? b ^ 1 : b)) } };
    expect(() => forged.ingest(tampered)).toThrow(IntegrityError);
    expect(entryHash(e)).not.toEqual(entryHash(tampered));
  });
});
