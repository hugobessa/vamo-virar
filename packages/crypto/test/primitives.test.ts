import { ed25519 } from "@noble/curves/ed25519";
import { concatBytes, encode, fromHex, utf8 } from "@vamo-virar/protocol";
import { describe, expect, it } from "vitest";
import { communityId, deriveEpochKeys, mailboxId, memberId } from "../src/keys.js";
import {
  aeadOpen,
  aeadSeal,
  frame,
  generateSigningKeyPair,
  hashCtx,
  sign,
  signingKeyPair,
  verify,
} from "../src/primitives.js";
import { memberIdOf } from "@vamo-virar/domain";
import { toHex } from "@vamo-virar/protocol";
import { flipBit, seededRng } from "./helpers.js";

const L = 2n ** 252n + 27742317777372353535851937790883648493n;

function leToBig(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!);
  return n;
}
function bigToLe(n: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

describe("signatures", () => {
  const kp = signingKeyPair(seededRng("sig")(32));
  const msg = { a: 1, b: utf8("x") };

  it("verifies and is context-separated", () => {
    const sig = sign(kp.sk, "vv/test/v1", msg);
    expect(verify(kp.pk, "vv/test/v1", msg, sig)).toBe(true);
    expect(verify(kp.pk, "vv/test/v2", msg, sig)).toBe(false);
    expect(verify(kp.pk, "vv/test/v1", { a: 2, b: utf8("x") }, sig)).toBe(false);
    expect(verify(generateSigningKeyPair().pk, "vv/test/v1", msg, sig)).toBe(false);
    expect(verify(kp.pk, "vv/test/v1", msg, flipBit(sig, 40))).toBe(false);
  });

  it("frames as ctx_len || ctx || cbor", () => {
    expect(frame("ab", 1)).toEqual(concatBytes(Uint8Array.of(2), utf8("ab"), encode(1)));
  });

  it("rejects non-canonical s (s + L)", () => {
    const sig = sign(kp.sk, "vv/test/v1", msg);
    const s = leToBig(sig.subarray(32));
    const malleated = concatBytes(sig.subarray(0, 32), bigToLe(s + L, 32));
    // noble's permissive mode would accept this; strict mode must not.
    expect(verify(kp.pk, "vv/test/v1", msg, malleated)).toBe(false);
  });

  it("rejects small-order public keys", () => {
    // Identity point and a point of order 8: classic weak keys.
    const identity = fromHex("0100000000000000000000000000000000000000000000000000000000000000");
    const order8 = fromHex("c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa");
    for (const pk of [identity, order8]) {
      expect(ed25519.Point.fromHex(pk).isSmallOrder()).toBe(true);
      // An "any message" signature for the identity key: R = identity, s = 0.
      const sig = concatBytes(identity, new Uint8Array(32));
      expect(verify(pk, "vv/test/v1", msg, sig)).toBe(false);
    }
  });

  it("returns false (never throws) on garbage", () => {
    expect(verify(new Uint8Array(32).fill(0xff), "vv/test/v1", msg, new Uint8Array(64))).toBe(false);
    expect(verify(new Uint8Array(31), "vv/test/v1", msg, new Uint8Array(64))).toBe(false);
  });
});

describe("AEAD", () => {
  it("round-trips and detects tampering", () => {
    const rng = seededRng("aead");
    const key = rng(32);
    const nonce = rng(24);
    const ct = aeadSeal(key, nonce, utf8("segredo"), utf8("aad"));
    expect(aeadOpen(key, nonce, ct, utf8("aad"))).toEqual(utf8("segredo"));
    expect(aeadOpen(key, nonce, ct, utf8("aae"))).toBeNull();
    expect(aeadOpen(key, nonce, flipBit(ct), utf8("aad"))).toBeNull();
    expect(aeadOpen(flipBit(key), nonce, ct, utf8("aad"))).toBeNull();
  });
});

describe("identifiers and derivations", () => {
  it("member_id agrees with the domain package", () => {
    const pk = generateSigningKeyPair().pk;
    expect(toHex(memberId(pk))).toBe(memberIdOf(toHex(pk)));
  });

  it("uses distinct contexts", () => {
    const pk = seededRng("ids")(32);
    const cid = communityId(pk);
    expect(cid).toEqual(hashCtx("vv/community-id/v1", pk));
    expect(memberId(pk)).not.toEqual(cid);
    expect(mailboxId(cid, pk)).not.toEqual(memberId(pk));
  });

  it("epoch keys are distinct per purpose, epoch and community", () => {
    const rng = seededRng("epoch");
    const k = rng(32);
    const cid = rng(32);
    const e0 = deriveEpochKeys(cid, 0, k);
    const e1 = deriveEpochKeys(cid, 1, k);
    const other = deriveEpochKeys(rng(32), 0, k);
    const all = [e0.opKey, e0.snapshotKey, e0.access.sk, e1.opKey, other.opKey].map(toHex);
    expect(new Set(all).size).toBe(all.length);
  });
});
