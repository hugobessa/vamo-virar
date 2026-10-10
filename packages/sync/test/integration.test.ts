// The whole stack against a real community-node binary: domain + crypto +
// sync + node over HTTP and WebSocket.

import { canonicalJson, type CommunityState } from "@vamo-virar/domain";
import { toHex } from "@vamo-virar/protocol";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeClient, NodeError } from "../src/client.js";
import { parseInvite } from "../src/invite.js";
import { Replica } from "../src/replica.js";
import { eventually, HAVE_NODE, startNode, type RunningNode } from "./node-process.js";

const canon = (s: CommunityState | null) => {
  if (!s) return "null";
  const { op_ids: _ignored, ...rest } = s;
  return canonicalJson(rest);
};

const DAY10 = Date.UTC(2026, 9, 18, 21);
function eventBody(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    event_id: id,
    title,
    starts_at: DAY10,
    ends_at: DAY10 + 3 * 3_600_000,
    tz: "America/Recife",
    location: { label: "Praça do Derby", area: { lat_e4: -80_571, lng_e4: -348_950 } },
    ...extra,
  };
}

async function admit(admin: Replica, applicant: Replica, role: "member" | "organizer" = "member") {
  const pending = await admin.joinRequests();
  const mine = pending.find((p) => toHex(p.request.msk) === toHex(applicant.keys.signing.pk));
  expect(mine, "join request reached the admin").toBeDefined();
  const outcome = await admin.approve(mine!, role);
  expect(outcome).toEqual({ status: "applied" });
  await applicant.sync();
  expect(applicant.status).toBe("active");
}

async function syncAll(...rs: Replica[]) {
  for (const r of rs) await r.sync();
  for (const r of rs) await r.sync();
}

describe.skipIf(!HAVE_NODE)("against a real node", () => {
  let node: RunningNode;
  beforeAll(async () => {
    node = await startNode({ epoch_grace_secs: 0 });
  });
  afterAll(() => node?.stop());

  it("founding, joining (open and invite-only), events, convergence", async () => {
    const ana = await Replica.found(node.client(), { name: "Coletivo Recife", displayName: "Ana" });
    expect(ana.isAdmin).toBe(true);

    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    expect(bia.status).toBe("joining");
    await bia.sync();
    expect(bia.status).toBe("joining");
    await admit(ana, bia, "organizer");

    await ana.setIntakeMode("invite_only");
    await expect(Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Sem convite" })).rejects.toThrow(/invite/);
    const link = await ana.createInvite({ maxUses: 1 });
    const caio = await Replica.join(node.client(), parseInvite(link), { displayName: "Caio" });
    await admit(ana, caio);

    const ev = toHex(new Uint8Array(16).fill(1));
    await bia.sync();
    bia.submit("event.create", eventBody(ev, "Ato na praça", { capacity: 10 }));
    expect(bia.view!.events[ev]).toBeDefined(); // optimistic
    await bia.sync();
    await caio.sync();
    caio.submit("participation.volunteer", { event_id: ev });
    await caio.sync();
    await bia.sync();
    bia.submit("participation.approve", { event_id: ev, member_id: caio.memberId });
    await syncAll(ana, bia, caio);

    expect(caio.canonical!.events[ev]!.participations[caio.memberId]!.status).toBe("confirmed");
    expect(canon(ana.canonical)).toBe(canon(bia.canonical));
    expect(canon(ana.canonical)).toBe(canon(caio.canonical));
    expect(bia.pending).toHaveLength(0);
    expect(ana.ownOutcomes.every((o) => o.outcome.status === "applied")).toBe(true);
  }, 30_000);

  it("rejected applicants learn they were rejected", async () => {
    const ana = await Replica.found(node.client(), { name: "C2", displayName: "Ana" });
    const fred = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Fred" });
    const [p] = await ana.joinRequests();
    await ana.reject(p!, "não conhecemos");
    await fred.sync();
    expect(fred.status).toBe("rejected");
    expect(await ana.joinRequests()).toHaveLength(0);
  });

  it("a device offline for 700 operations catches up through pagination", async () => {
    const ana = await Replica.found(node.client(), { name: "C3", displayName: "Ana" });
    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia);
    for (let i = 0; i < 700; i++) ana.submit("member.profile", { profile: { display_name: `Ana ${i}` } });
    while (ana.pending.length > 0) await ana.sync();
    const report = await bia.sync();
    expect(report.pulled).toBeGreaterThanOrEqual(700);
    expect(canon(bia.canonical)).toBe(canon(ana.canonical));
    expect(bia.canonical!.members[ana.memberId]!.profile!.display_name).toBe("Ana 699");
  }, 120_000);

  it("removal rotates the key: the removed member is locked out, offline members catch up", async () => {
    const ana = await Replica.found(node.client(), { name: "C4", displayName: "Ana" });
    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia, "organizer");
    const caio = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Caio" });
    await admit(ana, caio);
    await syncAll(ana, bia, caio);

    // Bia is offline from here on.
    await ana.removeMember(caio.memberId, "saiu do coletivo");
    expect(ana.epoch).toBe(1);
    const secret = toHex(new Uint8Array(16).fill(2));
    ana.submit("event.create", eventBody(secret, "Reunião da coordenação"));
    await ana.sync();

    await caio.sync();
    expect(caio.status).toBe("removed");
    expect(caio.canonical!.events[secret]).toBeUndefined();
    expect(caio.epoch).toBe(0);

    await bia.sync();
    expect(bia.status).toBe("active");
    expect(bia.epoch).toBe(1);
    expect(bia.canonical!.events[secret]!.title).toBe("Reunião da coordenação");
    expect(canon(bia.canonical)).toBe(canon(ana.canonical));
  }, 30_000);

  it("ops queued while a key is missing wait in the outbox, then land exactly once", async () => {
    const ana = await Replica.found(node.client(), { name: "C5", displayName: "Ana" });
    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia);
    const caio = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Caio" });
    await admit(ana, caio);
    await syncAll(ana, bia);

    bia.submit("member.profile", { profile: { display_name: "Bia (offline edit)" } });
    await ana.removeMember(caio.memberId);

    // Bia's key envelope is delayed: hide her mailbox for one sync.
    const realMailbox = bia.client.mailbox.bind(bia.client);
    bia.client.mailbox = async () => [];
    const r1 = await bia.sync();
    expect(r1.status).toBe("waiting_for_key");
    expect(bia.pending).toHaveLength(1);
    expect(bia.view!.members[bia.memberId]!.profile!.display_name).toBe("Bia (offline edit)");
    bia.client.mailbox = realMailbox;

    const r2 = await bia.sync();
    expect(r2.status).toBe("active");
    expect(bia.pending).toHaveLength(0);
    await ana.sync();
    expect(ana.canonical!.members[bia.memberId]!.profile!.display_name).toBe("Bia (offline edit)");
    expect(bia.ownOutcomes.filter((o) => o.type === "member.profile")).toHaveLength(1);
  }, 30_000);

  it("a lost response is retried without applying the op twice", async () => {
    let dropNext = false;
    const flaky: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (dropNext && String(input).endsWith("/ops") && init?.method === "POST") {
        dropNext = false;
        throw new TypeError("network connection lost"); // the node did process it
      }
      return res;
    };
    const ana = await Replica.found(node.client({ fetch: flaky }), { name: "C6", displayName: "Ana" });
    const ev = toHex(new Uint8Array(16).fill(3));
    ana.submit("event.create", eventBody(ev, "Uma vez só"));
    dropNext = true;
    await expect(ana.sync()).rejects.toThrow(/network/);
    expect(ana.pending).toHaveLength(1);
    await ana.sync();
    expect(ana.pending).toHaveLength(0);
    const creates = ana.ownOutcomes.filter((o) => o.type === "event.create");
    expect(creates.map((o) => o.outcome.status)).toEqual(["applied"]);
  }, 30_000);

  it("persists and resumes", async () => {
    const ana = await Replica.found(node.client(), { name: "C7", displayName: "Ana" });
    ana.submit("member.profile", { profile: { display_name: "Ana Persistida" } });
    const bytes = ana.save();
    const again = Replica.load(node.client(), bytes);
    expect(again.pending).toHaveLength(1);
    await again.sync();
    expect(again.canonical!.members[again.memberId]!.profile!.display_name).toBe("Ana Persistida");
    expect(again.isAdmin).toBe(true);
    // And a saved, synced replica round-trips to the same state.
    expect(canon(Replica.load(node.client(), again.save()).canonical)).toBe(canon(again.canonical));
  });

  it("organizers can ask who could come; answers are verdicts, signed, and cannot be forged", async () => {
    const ana = await Replica.found(node.client(), { name: "C11", displayName: "Ana" });
    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia);
    const caio = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Caio" });
    await admit(ana, caio);
    const ev = toHex(new Uint8Array(16).fill(5));
    ana.submit("event.create", eventBody(ev, "Mutirão"));
    await syncAll(ana, bia, caio);

    // Members cannot ask.
    await expect(bia.askWhoCanCome(ev)).rejects.toThrow(/organizers/);
    const sent = await ana.askWhoCanCome(ev);
    expect(sent.asked).toBe(2);

    await bia.sync();
    await caio.sync();
    expect(bia.incomingProbes.map((p) => p.eventId)).toEqual([ev]);
    await bia.answerProbe(bia.incomingProbes[0]!.probeId, "eligible");
    expect(bia.incomingProbes).toHaveLength(0);

    // Caio tries to answer as Bia ("not_eligible"), signing with his own key.
    const p = caio.incomingProbes[0]!;
    const { sealMail } = await import("../src/invite.js");
    const { sign, mailboxId } = await import("@vamo-virar/crypto");
    const { fromHex } = await import("@vamo-virar/protocol");
    const forgedSig = sign(caio.keys.signing.sk, "vv/probe-reply/v1", { cid: caio.cid, probe_id: fromHex(p.probeId), member_id: bia.memberId, answer: "not_eligible" });
    const forged = sealMail(caio.cid, p.replyTo, { kind: "probe_reply", probe_id: fromHex(p.probeId), member_id: bia.memberId, answer: "not_eligible", sig: forgedSig });
    const access = (caio as unknown as { currentAccess(): Parameters<typeof caio.client.postMailbox>[1] }).currentAccess();
    await caio.client.postMailbox(caio.cid, access, p.replyMbx, "probe_reply", forged, 3600);
    expect(p.replyMbx).toEqual(mailboxId(ana.cid, ana.keys.signing.pk));
    caio.dropProbe(p.probeId); // and never answers for himself

    await ana.sync();
    expect(ana.probeResults(ev)!.replies).toEqual({ [bia.memberId]: "eligible" });
  }, 30_000);

  it("members report to the admins only; admins block from a report and blocked people cannot be re-added", async () => {
    const ana = await Replica.found(node.client(), { name: "C12", displayName: "Ana" });
    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia);
    const caio = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Caio" });
    await admit(ana, caio);
    await syncAll(ana, bia, caio);

    await expect(bia.reportMember(bia.memberId, "spam")).rejects.toThrow(/yourself/);
    await bia.reportMember(caio.memberId, "harassment", "  mensagens ofensivas no grupo  ");
    await caio.sync();
    expect(caio.reports).toHaveLength(0); // only admins receive reports
    await ana.sync();
    expect(ana.reports).toHaveLength(1);
    expect(ana.reports[0]).toMatchObject({ reporter: bia.memberId, memberId: caio.memberId, reason: "harassment", details: "mensagens ofensivas no grupo" });

    // A forged report (Caio claiming to be Bia) is dropped.
    const { sealMail } = await import("../src/invite.js");
    const { sign, mailboxId } = await import("@vamo-virar/crypto");
    const forgedBody = { report_id: new Uint8Array(16).fill(9), reporter: bia.memberId, member_id: ana.memberId, reason: "spam" as const };
    const forgedSig = sign(caio.keys.signing.sk, "vv/report/v1", { cid: caio.cid, ...forgedBody });
    const access = (caio as unknown as { currentAccess(): Parameters<typeof caio.client.postMailbox>[1] }).currentAccess();
    await caio.client.postMailbox(caio.cid, access, mailboxId(ana.cid, ana.keys.signing.pk), "report", sealMail(caio.cid, ana.keys.encryption.pk, { kind: "report", ...forgedBody, sig: forgedSig }), 3600);
    await ana.sync();
    expect(ana.reports).toHaveLength(1);

    await expect(bia.blockMember(caio.memberId)).rejects.toThrow(/only admins/);
    await ana.blockMember(caio.memberId, "assédio");
    expect(ana.reports).toHaveLength(0);
    expect(ana.canonical!.members[caio.memberId]).toMatchObject({ status: "removed", blocked: true });
    expect(ana.epoch).toBe(1);
    await caio.sync();
    expect(caio.status).toBe("removed");
    await bia.sync();
    expect(bia.epoch).toBe(1);
    expect(canon(bia.canonical)).toBe(canon(ana.canonical));

    // Re-adding the same keys is refused until an admin unblocks.
    ana.submit("member.add", { msk: toHex(caio.keys.signing.pk), mek: toHex(caio.keys.encryption.pk), profile: { display_name: "Caio" } });
    const report = await ana.sync();
    expect(report.rejected.map((r) => r.reason)).toEqual(["not_authorized"]);
    await ana.unblockMember(caio.memberId);
    expect(ana.canonical!.members[caio.memberId]!.blocked).toBeUndefined();
  }, 30_000);

  it("watch() syncs when the node announces new entries", async () => {
    const ana = await Replica.found(node.client(), { name: "C8", displayName: "Ana" });
    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia);
    const stop = await bia.watch();
    try {
      ana.submit("member.profile", { profile: { display_name: "Ana ao vivo" } });
      await ana.sync();
      await eventually(() => bia.canonical?.members[ana.memberId]?.profile?.display_name === "Ana ao vivo");
    } finally {
      stop();
    }
  });
});

describe.skipIf(!HAVE_NODE)("compaction and node replacement", () => {
  let node: RunningNode;
  let spare: RunningNode;
  beforeAll(async () => {
    node = await startNode({ compaction_grace_secs: 0, housekeeping_interval_secs: 1 });
    spare = await startNode();
  });
  afterAll(async () => {
    await node?.stop();
    await spare?.stop();
  });

  it("devices behind compaction and new members bootstrap from the snapshot", async () => {
    const ana = await Replica.found(node.client(), { name: "C9", displayName: "Ana" });
    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia);
    for (let i = 0; i < 20; i++) ana.submit("member.profile", { profile: { display_name: `Ana ${i}` } });
    await ana.sync();
    const snap = await ana.makeSnapshot();
    await new Promise((r) => setTimeout(r, 2500)); // housekeeping compacts behind it

    // Bia last synced before the snapshot: the node says "gone", she restores.
    await bia.sync();
    expect(canon(bia.canonical)).toBe(canon(ana.canonical));

    const eva = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Eva" });
    await admit(ana, eva);
    await syncAll(ana, eva);
    expect(eva.canonical!.clock.seq).toBe(ana.canonical!.clock.seq);
    expect(canon(eva.canonical)).toBe(canon(ana.canonical));
    expect(snap.seq).toBeGreaterThan(20);
  }, 30_000);

  it("an admin rebuilds the community on a new node and everyone carries on", async () => {
    const ana = await Replica.found(node.client(), { name: "C10", displayName: "Ana" });
    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia, "organizer");
    const caio = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Caio" });
    await admit(ana, caio);
    await ana.removeMember(caio.memberId); // a rotation and a snapshot in the history
    const ev = toHex(new Uint8Array(16).fill(4));
    await bia.sync();
    bia.submit("event.create", eventBody(ev, "Antes da mudança"));
    await syncAll(ana, bia);

    const head = await ana.restoreTo(spare.client());
    expect(head).toBe(ana.canonical!.clock.seq);

    bia.moveTo(spare.client());
    bia.submit("participation.volunteer", { event_id: ev });
    await bia.sync();
    await ana.sync();
    expect(ana.canonical!.events[ev]!.participations[bia.memberId]!.status).toBe("volunteered");
    expect(canon(ana.canonical)).toBe(canon(bia.canonical));
  }, 30_000);
});

describe.skipIf(!HAVE_NODE)("moving between managed hosting and a self-hosted node", () => {
  const TENANT_TOKEN = "tenant-coletivo-token";
  let managed: RunningNode;
  let selfHosted: RunningNode;
  beforeAll(async () => {
    const sha = createHash("sha256").update(TENANT_TOKEN).digest("hex");
    managed = await startNode({}, `[[tenants]]\nname = "coletivo"\ntoken_sha256 = "${sha}"\nmax_communities = 3\n`);
    selfHosted = await startNode();
  });
  afterAll(async () => {
    await managed?.stop();
    await selfHosted?.stop();
  });

  it("members follow a signed move, offline ones included; old links still work", async () => {
    const tenant = new NodeClient(managed.url, { provisioningToken: TENANT_TOKEN });
    const ana = await Replica.found(tenant, { name: "C11", displayName: "Ana" });
    const bia = await Replica.join(managed.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia, "organizer");
    const caio = await Replica.join(managed.client(), parseInvite(ana.openInviteLink()), { displayName: "Caio" });
    await admit(ana, caio);
    const oldLink = ana.openInviteLink();
    const invite = await ana.createInvite({ maxUses: 2 });
    const ev = toHex(new Uint8Array(16).fill(11));
    bia.submit("event.create", eventBody(ev, "Antes da mudança"));
    await syncAll(ana, bia, caio);
    // Caio goes offline here and stays away for the whole move.

    const head = await ana.migrateTo(selfHosted.client());
    expect(ana.node).toBe(selfHosted.url);
    expect(head).toBeGreaterThan(0);
    expect(ana.canonical!.community.nodes).toEqual([selfHosted.url]);

    // The old node refuses writes and points at the new one.
    await expect(managed.client().submitJoinRequest(ana.cid, { enc: new Uint8Array(32), ct: new Uint8Array(8) })).rejects.toMatchObject({
      code: "moved",
    });

    // Bia changed something before hearing about the move: it waits, then lands on the new node.
    bia.submit("participation.volunteer", { event_id: ev });
    const report = await bia.sync();
    expect(bia.node).toBe(selfHosted.url);
    expect(bia.pending).toHaveLength(0);
    expect(report.blocked).toBeUndefined();
    await ana.sync();
    expect(ana.canonical!.events[ev]!.participations[bia.memberId]!.status).toBe("volunteered");

    // Caio comes back much later and finds his way.
    caio.submit("member.profile", { profile: { display_name: "Caio voltou" } });
    await caio.sync();
    expect(caio.node).toBe(selfHosted.url);
    await syncAll(ana, bia, caio);
    expect(canon(caio.canonical)).toBe(canon(ana.canonical));
    expect(ana.canonical!.members[caio.memberId]!.profile!.display_name).toBe("Caio voltou");

    // A link shared before the move still works: the request follows to the new node.
    const dani = await Replica.join(managed.client(), parseInvite(oldLink), { displayName: "Dani" });
    expect(dani.node).toBe(selfHosted.url);
    await admit(ana, dani);
    // Invite-only links carried over too.
    await ana.setIntakeMode("invite_only");
    const eva = await Replica.join(managed.client(), parseInvite(invite), { displayName: "Eva" });
    await admit(ana, eva);
    expect(eva.node).toBe(selfHosted.url);
  }, 30_000);

  it("a move to a node that refuses the restore is cancelled", async () => {
    const tenant = new NodeClient(managed.url, { provisioningToken: TENANT_TOKEN });
    const ana = await Replica.found(tenant, { name: "C12", displayName: "Ana" });
    const bia = await Replica.join(managed.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia);
    // No provisioning token for the target: it refuses the restore.
    await expect(ana.migrateTo(new NodeClient(selfHosted.url))).rejects.toBeInstanceOf(NodeError);
    expect(ana.node).toBe(managed.url);
    expect(ana.canonical!.community.nodes).toBeUndefined();
    bia.submit("member.profile", { profile: { display_name: "Bia fica" } });
    await bia.sync();
    expect(bia.node).toBe(managed.url);
    expect(bia.pending).toHaveLength(0);
  }, 30_000);
});
