import { decode, encode, utf8 } from "@vamo-virar/protocol";
import { describe, expect, it } from "vitest";
import {
  decodeEnvelope,
  encodeEnvelope,
  envelopeToCbor,
  openOp,
  sealOp,
  verifyAccess,
  verifyControl,
  type OpEnvelope,
} from "../src/envelope.js";
import { openJoinRequest, sealJoinRequest, signAuth, verifyAuth } from "../src/intake.js";
import { openKeyEnvelope, sealKeyEnvelope } from "../src/keyenv.js";
import { generateEpochKeys, generateMemberKeys } from "../src/keys.js";
import { aeadOpen, aeadSeal, generateEncryptionKeyPair, sign, CTX } from "../src/primitives.js";
import { WireError } from "../src/wire.js";
import { flipBit, seededRng } from "./helpers.js";

const rng = seededRng("envelope");
const cid = rng(32);
const k0 = generateEpochKeys(cid, 0, rng);
const k1 = generateEpochKeys(cid, 1, rng);
const alice = generateMemberKeys(rng);
const mallory = generateMemberKeys(rng);

function seal(over: Partial<Parameters<typeof sealOp>[0]> = {}): OpEnvelope {
  return sealOp({
    cid,
    opId: rng(16),
    epoch: k0,
    author: alice.signing,
    base: 7,
    ts: 123,
    type: "member.profile",
    body: { profile: { display_name: "Alice" } },
    rng,
    ...over,
  });
}

describe("op envelopes", () => {
  it("round-trips through CBOR and opens", () => {
    const env = seal();
    const back = decodeEnvelope(encodeEnvelope(env));
    expect(back).toEqual(env);
    expect(verifyAccess(back, k0.access.pk)).toBe(true);
    const opened = openOp(back, k0);
    expect(opened).toEqual({
      ok: true,
      op: { author: alice.signing.pk, base: 7, ts: 123, type: "member.profile", body: { profile: { display_name: "Alice" } } },
    });
  });

  it("any change to the envelope breaks the access signature", () => {
    const env = seal();
    const variants: OpEnvelope[] = [
      { ...env, epoch: 1 },
      { ...env, op_id: flipBit(env.op_id) },
      { ...env, cid: flipBit(env.cid) },
      { ...env, nonce: flipBit(env.nonce) },
      { ...env, ct: flipBit(env.ct, 5) },
    ];
    for (const v of variants) expect(verifyAccess(v, k0.access.pk)).toBe(false);
    expect(verifyAccess(env, k1.access.pk)).toBe(false);
  });

  it("the wrong epoch key cannot open it", () => {
    const env = seal();
    expect(openOp(env, undefined)).toEqual({ ok: false, problem: "no_key" });
    expect(openOp({ ...env }, { ...k1, epoch: 0 })).toEqual({ ok: false, problem: "undecryptable" });
  });

  it("a member cannot lift someone's signed op into a new envelope", () => {
    // Mallory holds K0 (a member), decrypts Alice's op and re-wraps the exact
    // signed plaintext under a fresh op_id so it would apply twice.
    const env = seal();
    const aad = encode({ v: 1, cid, op_id: env.op_id, epoch: 0, plane: "d" });
    const pt = aeadOpen(k0.opKey, env.nonce, env.ct, aad)!;
    const opId = rng(16);
    const newAad = encode({ v: 1, cid, op_id: opId, epoch: 0, plane: "d" });
    const nonce = rng(24);
    const ct = aeadSeal(k0.opKey, nonce, pt, newAad);
    const header = { v: 1, cid, op_id: opId, epoch: 0, plane: "d" };
    const asig = sign(k0.access.sk, CTX.opAccess, { ...header, nonce, ct });
    const lifted: OpEnvelope = { v: 1, cid, op_id: opId, epoch: 0, plane: "d", nonce, ct, asig };
    expect(verifyAccess(lifted, k0.access.pk)).toBe(true); // the node can't tell…
    expect(openOp(lifted, k0)).toEqual({ ok: false, problem: "binding_mismatch" }); // …devices can.
  });

  it("a signed op missing its body is malformed (not defaulted)", () => {
    const opId = rng(16);
    const unsigned = { op_id: opId, cid, epoch: 0, author: alice.signing.pk, base: 0, ts: 0, type: "member.leave" };
    const pt = encode({ ...unsigned, sig: sign(alice.signing.sk, CTX.opSig, unsigned) });
    const header = { v: 1, cid, op_id: opId, epoch: 0, plane: "d" };
    const nonce = rng(24);
    const ct = aeadSeal(k0.opKey, nonce, pt, encode(header));
    const asig = sign(k0.access.sk, CTX.opAccess, { ...header, nonce, ct });
    const env: OpEnvelope = { v: 1, cid, op_id: opId, epoch: 0, plane: "d", nonce, ct, asig };
    expect(openOp(env, k0)).toEqual({ ok: false, problem: "malformed" });
  });

  it("a member cannot write as someone else", () => {
    const env = seal({ author: { sk: mallory.signing.sk, pk: alice.signing.pk } });
    expect(verifyAccess(env, k0.access.pk)).toBe(true);
    expect(openOp(env, k0)).toEqual({ ok: false, problem: "bad_signature" });
  });

  it("control headers must be signed by their signer", () => {
    const good = seal({
      type: "epoch.rotate",
      control: { kind: "rotate", signer: alice.signing, args: { new_epoch: 1, eak: k1.access.pk } },
    });
    expect(verifyControl(good)).toBe(true);
    const forged = seal({
      type: "epoch.rotate",
      control: { kind: "rotate", signer: { sk: mallory.signing.sk, pk: alice.signing.pk }, args: { new_epoch: 1, eak: k1.access.pk } },
    });
    expect(verifyControl(forged)).toBe(false);
    // Changing the cleartext args after signing is caught by both signatures.
    const edited: OpEnvelope = { ...good, ctrl: { ...good.ctrl!, args: { new_epoch: 2, eak: k1.access.pk } } as NonNullable<OpEnvelope["ctrl"]> };
    expect(verifyControl(edited)).toBe(false);
    expect(verifyAccess(edited, k0.access.pk)).toBe(false);
  });

  it("strict decoding: unknown fields, missing ctrl, wrong sizes", () => {
    const env = seal();
    const m = envelopeToCbor(env);
    expect(() => decodeEnvelope(encode({ ...m, extra: 1 }))).toThrow(WireError);
    expect(() => decodeEnvelope(encode({ ...m, plane: "c" }))).toThrow(WireError);
    expect(() => decodeEnvelope(encode({ ...m, op_id: rng(15) }))).toThrow(WireError);
    expect(() => decodeEnvelope(encode({ ...m, v: 2 }))).toThrow(WireError);
    expect(decode(encodeEnvelope(env))).toEqual(m);
  });
});

describe("key envelopes", () => {
  it("open only for the intended recipient and binding", () => {
    const bob = generateEncryptionKeyPair(rng);
    const eve = generateEncryptionKeyPair(rng);
    const env = sealKeyEnvelope(cid, 3, k1.key, bob.pk, { rng });
    expect(openKeyEnvelope(env, bob)).toEqual(k1.key);
    expect(openKeyEnvelope(env, eve)).toBeNull();
    expect(openKeyEnvelope({ ...env, epoch: 4 }, bob)).toBeNull();
    expect(openKeyEnvelope({ ...env, cid: flipBit(cid) }, bob)).toBeNull();
    expect(openKeyEnvelope({ ...env, ct: flipBit(env.ct) }, bob)).toBeNull();
  });
});

describe("join requests", () => {
  const ik = generateEncryptionKeyPair(rng);
  const applicant = generateMemberKeys(rng);

  it("open for admins, bound to the community and the applicant's key", () => {
    const sealed = sealJoinRequest(ik.pk, applicant, { cid, profile: { display_name: "Bob" }, message: "oi" }, { rng });
    const req = openJoinRequest(sealed, cid, ik);
    expect(req).toMatchObject({ msk: applicant.signing.pk, mek: applicant.encryption.pk, message: "oi" });
    expect(openJoinRequest(sealed, flipBit(cid), ik)).toBeNull();
    expect(openJoinRequest(sealed, cid, generateEncryptionKeyPair(rng))).toBeNull();
    expect(openJoinRequest({ ...sealed, ct: flipBit(sealed.ct) }, cid, ik)).toBeNull();
  });

  it("a request sealed for another community is refused even with the same intake key", () => {
    const other = rng(32);
    const sealed = sealJoinRequest(ik.pk, applicant, { cid: other, profile: { display_name: "Bob" } }, { rng });
    expect(openJoinRequest(sealed, cid, ik)).toBeNull();
  });
});

describe("node auth", () => {
  it("binds community, node, nonce and scope", () => {
    const c = { community_id: cid, node_id: rng(32), nonce: rng(32), scope: "mailbox" as const };
    const sig = signAuth(alice.signing, c);
    expect(verifyAuth(alice.signing.pk, c, sig)).toBe(true);
    expect(verifyAuth(alice.signing.pk, { ...c, node_id: rng(32) }, sig)).toBe(false);
    expect(verifyAuth(alice.signing.pk, { ...c, scope: "control" }, sig)).toBe(false);
    expect(verifyAuth(alice.signing.pk, { ...c, nonce: utf8("x".repeat(32)) }, sig)).toBe(false);
  });
});
