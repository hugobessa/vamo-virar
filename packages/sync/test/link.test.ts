import { generateEncryptionKeyPair, generateSigningKeyPair } from "@vamo-virar/crypto";
import { describe, expect, it } from "vitest";
import { deviceSetValid, preferDeviceSet, signDeviceSet, type DeviceSet } from "../src/devices.js";
import { openMail, sealMail } from "../src/invite.js";
import { decodeLinkBundle, deviceLinkUrl, encodeLinkBundle, parseDeviceLink, type LinkBundle } from "../src/link.js";

const cid = new Uint8Array(32).fill(1);
const secret = new Uint8Array(32).fill(2);

describe("device links", () => {
  it("round-trip, with and without the code, in the fragment", () => {
    const node = "https://node.example.org:8443/base";
    const qr = deviceLinkUrl({ node, cid, secret, code: "K7QM2XRA9P" });
    expect(qr).toMatch(/^https:\/\/web\.vamovirar\.app\/link#n=/);
    expect(parseDeviceLink(qr)).toEqual({ node, cid, secret, code: "K7QM2XRA9P" });
    const copy = deviceLinkUrl({ node, cid, secret });
    expect(parseDeviceLink(copy)).toEqual({ node, cid, secret });
    expect(parseDeviceLink(copy.replace("https://web.vamovirar.app/link#", "vamovirar://link?"))).toEqual({ node, cid, secret });
  });

  it("refuse anything else", () => {
    const ok = deviceLinkUrl({ node: "https://n.example", cid, secret });
    expect(() => parseDeviceLink(ok.replace("/link#", "/join#"))).toThrow(/not a device link/);
    expect(() => parseDeviceLink(ok.replace("https://web", "http://web"))).toThrow(/not a device link/);
    expect(() => parseDeviceLink(ok.replace(/s=[0-9a-f]+/, "s=abcd"))).toThrow(/malformed keys/);
    expect(() => parseDeviceLink(`${ok}&w=NOPE`)).toThrow(/malformed code/);
  });
});

describe("link bundles", () => {
  it("round-trip and reject garbage", () => {
    const msk = generateSigningKeyPair();
    const dik = generateSigningKeyPair();
    const devices = signDeviceSet(cid, msk, { ver: 1, main: dik.pk, devices: [{ dik: dik.pk, label: "Celular", added: 1 }] });
    const b: LinkBundle = {
      v: 1,
      expires: 1_000,
      communities: [
        { cid, node: "https://n.example", msk: msk.sk, mek: new Uint8Array(32).fill(4), epochs: [{ epoch: 0, key: new Uint8Array(32).fill(5) }], ik: new Uint8Array(32).fill(6), devices },
        { cid: new Uint8Array(32).fill(9), node: "https://m.example", msk: msk.sk, mek: msk.sk, epochs: [{ epoch: 3, key: secret }] },
      ],
    };
    expect(decodeLinkBundle(encodeLinkBundle(b))).toEqual(b);
    expect(() => decodeLinkBundle(new Uint8Array([1, 2, 3]))).toThrow(/malformed/);
    expect(() => decodeLinkBundle(encodeLinkBundle({ ...b, communities: [{ ...b.communities[1]!, epochs: [] }] }))).toThrow(/malformed/);
  });
});

describe("device sets", () => {
  const msk = generateSigningKeyPair();
  const mek = generateEncryptionKeyPair();
  const a = generateSigningKeyPair().pk;
  const b = generateSigningKeyPair().pk;
  const set = (ver: number, main = a, label = "Celular"): DeviceSet =>
    signDeviceSet(cid, msk, { ver, main, devices: [{ dik: a, label, added: 1 }, { dik: b, label: "Navegador", added: 2 }] });

  it("travel sealed to the member and verify only under their own key", () => {
    const s = set(2);
    const m = openMail(cid, "devices", mek, sealMail(cid, mek.pk, { kind: "devices", set: s }));
    expect(m).toEqual({ kind: "devices", set: s });
    expect(deviceSetValid(cid, msk.pk, s)).toBe(true);
    // Another member knows the MEK and the mailbox, but cannot sign.
    const other = generateSigningKeyPair();
    const forged = signDeviceSet(cid, other, { ver: 99, main: b, devices: s.devices });
    expect(deviceSetValid(cid, msk.pk, forged)).toBe(false);
    expect(deviceSetValid(cid, msk.pk, { ...s, main: b })).toBe(false);
    expect(deviceSetValid(new Uint8Array(32).fill(8), msk.pk, s)).toBe(false);
  });

  it("refuse a main that is not listed, or repeated devices", () => {
    const bad = signDeviceSet(cid, msk, { ver: 1, main: new Uint8Array(32).fill(3), devices: [{ dik: a, label: "x", added: 1 }] });
    expect(openMail(cid, "devices", mek, sealMail(cid, mek.pk, { kind: "devices", set: bad }))).toBeNull();
    const dup = signDeviceSet(cid, msk, { ver: 1, main: a, devices: [{ dik: a, label: "x", added: 1 }, { dik: a, label: "y", added: 2 }] });
    expect(openMail(cid, "devices", mek, sealMail(cid, mek.pk, { kind: "devices", set: dup }))).toBeNull();
  });

  it("prefer the higher version, then the larger hash, the same way everywhere", () => {
    expect(preferDeviceSet(set(2), set(1))).toBe(true);
    expect(preferDeviceSet(set(1), set(2))).toBe(false);
    expect(preferDeviceSet(set(1), undefined)).toBe(true);
    const x = set(3, a);
    const y = set(3, b);
    expect(preferDeviceSet(x, y)).toBe(!preferDeviceSet(y, x));
    expect(preferDeviceSet(x, x)).toBe(false);
  });
});
