// Linked devices (protocol.md §10.5) against a real community-node binary:
// linking by QR and by copied link, a main device forwarding the member's
// mail, switching the main device, and unlinking.

import { mailboxId } from "@vamo-virar/crypto";
import { canonicalJson, type CommunityState } from "@vamo-virar/domain";
import { toHex } from "@vamo-virar/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeClient } from "../src/client.js";
import { parseInvite } from "../src/invite.js";
import { LinkError, parseDeviceLink, receiveDeviceLink, type LinkBundle } from "../src/link.js";
import { offerDeviceLink } from "../src/offer.js";
import { Replica } from "../src/replica.js";
import { HAVE_NODE, startNode, type RunningNode } from "./node-process.js";

const canon = (s: CommunityState | null) => {
  if (!s) return "null";
  const { op_ids: _ignored, ...rest } = s;
  return canonicalJson(rest);
};

const DAY10 = Date.UTC(2026, 9, 18, 21);
const eventBody = (id: string, title: string) => ({
  event_id: id,
  title,
  starts_at: DAY10,
  ends_at: DAY10 + 3 * 3_600_000,
  tz: "America/Recife",
  location: { label: "Praça do Derby", area: { lat_e4: -80_571, lng_e4: -348_950 } },
});

async function admit(admin: Replica, applicant: Replica, role: "member" | "organizer" = "member") {
  const mine = (await admin.joinRequests()).find((p) => toHex(p.request.msk) === toHex(applicant.keys.signing.pk));
  expect(await admin.approve(mine!, role)).toEqual({ status: "applied" });
  await applicant.sync();
  expect(applicant.status).toBe("active");
}

/** Links `from`'s memberships to a new device; returns the new device's replicas, synced once. */
async function link(from: Replica[], label = "Navegador"): Promise<Replica[]> {
  const offer = await offerDeviceLink(from, "Celular");
  const bundle = await receiveDeviceLink(parseDeviceLink(offer.qr), parseDeviceLink(offer.qr).code!);
  const out = bundle.communities.map((e) => Replica.fromLink(new NodeClient(e.node), e, label));
  for (const r of out) await r.sync();
  return out;
}

/** Items still waiting in a member's own mailbox. */
async function waiting(r: Replica) {
  return r.client.mailbox(r.cid, r.keys.signing, mailboxId(r.cid, r.keys.signing.pk));
}

describe.skipIf(!HAVE_NODE)("linked devices against a real node", () => {
  let node: RunningNode;
  beforeAll(async () => {
    node = await startNode({ epoch_grace_secs: 0, intake_per_ip_per_hour: 1000 });
  });
  afterAll(() => node?.stop());

  async function community(name: string) {
    const ana = await Replica.found(node.client(), { name, displayName: "Ana" });
    const bia = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Bia" });
    await admit(ana, bia, "organizer");
    const caio = await Replica.join(node.client(), parseInvite(ana.openInviteLink()), { displayName: "Caio" });
    await admit(ana, caio);
    for (const r of [ana, bia, caio]) await r.sync();
    return { ana, bia, caio };
  }

  it("a QR link moves the keys, the new device downloads the community and joins the device set", async () => {
    const { ana, bia } = await community("D1");
    const [phone] = [bia];
    const [web] = await link([phone]);
    expect(web!.memberId).toBe(phone.memberId);
    expect(web!.status).toBe("active");
    expect(canon(web!.canonical)).toBe(canon(phone.canonical));
    expect(web!.recoveryKey).toBeUndefined();

    await phone.sync();
    expect(phone.linkedDevices.map((d) => [d.label, d.main, d.me])).toEqual([
      ["Celular", true, true],
      ["Navegador", false, false],
    ]);
    expect(web!.isMainDevice).toBe(false);
    expect(phone.isMainDevice).toBe(true);

    // Both write as the same member.
    const ev = toHex(new Uint8Array(16).fill(1));
    web!.submit("event.create", eventBody(ev, "Panfletagem"));
    await web!.sync();
    await phone.sync();
    await ana.sync();
    expect(phone.canonical!.events[ev]!.organizers).toEqual([phone.memberId]);
    expect(ana.canonical!.events[ev]).toBeDefined();
  }, 30_000);

  it("a copied link needs the code; a wrong one leaves the bundle, and it works only once", async () => {
    const { bia } = await community("D2");
    const offer = await offerDeviceLink([bia], "Celular");
    const copied = parseDeviceLink(offer.copy);
    expect(copied.code).toBeUndefined();
    expect(offer.copy).not.toContain(offer.code.replace(/-/g, ""));
    expect(await offer.taken()).toBe(false);

    const wrong = offer.code.startsWith("0") ? "1" + offer.code.slice(1) : "0" + offer.code.slice(1);
    await expect(receiveDeviceLink(copied, wrong)).rejects.toMatchObject({ code: "wrong_code" });
    expect(await offer.taken()).toBe(false);

    const bundle: LinkBundle = await receiveDeviceLink(copied, offer.code.toLowerCase());
    expect(bundle.communities.map((c) => toHex(c.cid))).toEqual([toHex(bia.cid)]);
    expect(await offer.taken()).toBe(true);
    await expect(receiveDeviceLink(copied, offer.code)).rejects.toBeInstanceOf(LinkError);
    await expect(receiveDeviceLink(copied, offer.code)).rejects.toMatchObject({ code: "expired" });
  }, 30_000);

  it("a cancelled link cannot be used", async () => {
    const { bia } = await community("D3");
    const offer = await offerDeviceLink([bia], "Celular");
    await offer.cancel();
    const l = parseDeviceLink(offer.qr);
    await expect(receiveDeviceLink(l, l.code!)).rejects.toMatchObject({ code: "expired" });
  }, 30_000);

  it("a rotation reaches the secondary while the main device is offline, and after the main confirms it", async () => {
    const { ana, bia, caio } = await community("D4");
    const [web] = await link([bia]);
    await bia.sync(); // sees the new device

    // The phone (main) is offline: the browser reads the member's mailbox without confirming.
    await ana.removeMember(caio.memberId);
    const secret = toHex(new Uint8Array(16).fill(2));
    ana.submit("event.create", eventBody(secret, "Só para quem ficou"));
    await ana.sync();
    await web!.sync();
    expect(web!.epoch).toBe(1);
    expect(web!.canonical!.events[secret]).toBeDefined();
    expect((await waiting(bia)).some((i) => i.kind === "key_env")).toBe(true); // still there for the main

    // The phone comes back, forwards, and confirms. Another rotation, now with the phone online first.
    await bia.sync();
    expect(bia.epoch).toBe(1);
    expect((await waiting(bia)).some((i) => i.kind === "key_env")).toBe(false);
    await ana.rotate();
    await bia.sync(); // main: forwards to the browser's mailbox, then confirms
    expect((await waiting(bia)).filter((i) => i.kind !== "devices")).toEqual([]);
    await web!.sync();
    expect(web!.epoch).toBe(2);
    expect(web!.status).toBe("active");
  }, 30_000);

  it("switching the main device while the old one still thinks it is main loses nothing", async () => {
    const { ana, bia } = await community("D5");
    const [web] = await link([bia]);
    await bia.sync();

    await web!.makeMainDevice();
    expect(web!.isMainDevice).toBe(true);
    expect(bia.isMainDevice).toBe(true); // has not synced yet

    // A rotation arrives while both believe they are main.
    await ana.rotate();
    await web!.sync(); // new main: forwards to the phone, confirms
    await bia.sync(); // reads the new set first, steps down; the key came forwarded
    expect(bia.isMainDevice).toBe(false);
    expect(bia.epoch).toBe(1);
    expect(web!.epoch).toBe(1);

    // From now on the phone only reads; the browser confirms.
    await ana.rotate();
    await bia.sync();
    expect(bia.epoch).toBe(2);
    expect((await waiting(bia)).some((i) => i.kind === "key_env")).toBe(true);
    await web!.sync();
    expect((await waiting(bia)).some((i) => i.kind === "key_env")).toBe(false);
    expect((await waiting(bia)).filter((i) => i.kind === "devices")).toHaveLength(1);
  }, 30_000);

  it("a probe answered on one device disappears from the other", async () => {
    const { ana, bia } = await community("D6");
    const [web] = await link([bia]);
    await bia.sync();
    const ev = toHex(new Uint8Array(16).fill(3));
    ana.submit("event.create", eventBody(ev, "Mutirão"));
    await ana.sync();
    await ana.askWhoCanCome(ev);
    await bia.sync();
    await web!.sync();
    expect(bia.incomingProbes).toHaveLength(1);
    expect(web!.incomingProbes).toHaveLength(1);

    await web!.answerProbe(web!.incomingProbes[0]!.probeId, "maybe");
    await web!.sync(); // tells the other devices
    await bia.sync();
    expect(bia.incomingProbes).toHaveLength(0);
    await ana.sync();
    expect(ana.probeResults(ev)!.replies).toEqual({ [bia.memberId]: "maybe" });
  }, 30_000);

  it("unlinking stops a device that still obeys; a device that already has the membership just absorbs the link", async () => {
    const { bia } = await community("D7");
    const [web] = await link([bia]);
    await bia.sync();

    // Linking again to a device that already has it: no duplicate.
    const offer = await offerDeviceLink([bia], "Celular");
    const l = parseDeviceLink(offer.qr);
    const bundle = await receiveDeviceLink(l, l.code!);
    web!.absorbLink(bundle.communities[0]!, "Navegador");
    await web!.sync();
    await bia.sync();
    expect(bia.linkedDevices).toHaveLength(2);

    const webId = bia.linkedDevices.find((d) => !d.me)!.id;
    await bia.unlinkDevice(webId);
    expect(bia.linkedDevices).toHaveLength(1);
    await web!.sync();
    expect(web!.unlinked).toBe(true);
  }, 30_000);

  it("one link carries every active membership, even on different nodes", async () => {
    const other = await startNode({ epoch_grace_secs: 0, intake_per_ip_per_hour: 1000 });
    try {
      const { bia } = await community("D9");
      const own = await Replica.found(other.client(), { name: "D9b", displayName: "Bia" });
      const [web1, web2] = await link([bia, own]);
      expect(web1!.canonical!.community.name).toBe("D9");
      expect(web2!.canonical!.community.name).toBe("D9b");
      expect(web2!.node).toBe(other.url);
      expect(web2!.isAdmin).toBe(true);
      await own.sync();
      expect(own.linkedDevices).toHaveLength(2);
    } finally {
      await other.stop();
    }
  }, 30_000);

  it("a new device that loses a tie with another change adds itself again", async () => {
    const { bia } = await community("D8");
    const offer = await offerDeviceLink([bia], "Celular");
    const l = parseDeviceLink(offer.qr);
    const bundle = await receiveDeviceLink(l, l.code!);
    const web = Replica.fromLink(new NodeClient(bundle.communities[0]!.node), bundle.communities[0]!, "Navegador");
    // The phone renames itself (ver 2) before the browser announces (also ver 2).
    await bia.renameDevice("Celular da Bia");
    await web.sync();
    await bia.sync();
    await web.sync();
    await bia.sync();
    expect(web.unlinked).toBe(false);
    expect(bia.linkedDevices.map((d) => d.label).sort()).toEqual(["Celular da Bia", "Navegador"]);
    expect(web.linkedDevices.map((d) => d.label).sort()).toEqual(["Celular da Bia", "Navegador"]);
  }, 30_000);
});
