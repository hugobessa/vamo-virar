import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deriveKeyPair, hpkeOpen, hpkeSeal } from "../src/hpke.js";
import { generateEncryptionKeyPair } from "../src/primitives.js";

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

const ab = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;

describe("HPKE interop with hpke-js (independent implementation)", () => {
  it("DeriveKeyPair matches", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 64 }), async (ikm) => {
        const ours = deriveKeyPair(ikm);
        const theirs = await suite.kem.deriveKeyPair(ab(ikm));
        const pk = new Uint8Array(await suite.kem.serializePublicKey(theirs.publicKey));
        const sk = new Uint8Array(await suite.kem.serializePrivateKey(theirs.privateKey));
        expect(ours.pk).toEqual(pk);
        expect(ours.sk).toEqual(sk);
      }),
      { numRuns: 25 },
    );
  });

  it("hpke-js opens what we seal, and we open what hpke-js seals", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 200 }), fc.uint8Array({ maxLength: 40 }), fc.uint8Array({ maxLength: 40 }), async (pt, info, aad) => {
        const r = generateEncryptionKeyPair();
        const recipientKey = await suite.kem.importKey("raw", ab(r.sk), false);
        const recipientPublicKey = await suite.kem.importKey("raw", ab(r.pk), true);

        const ours = hpkeSeal(r.pk, info, aad, pt);
        const opened = await suite.open({ recipientKey, enc: ab(ours.enc), info: ab(info) }, ab(ours.ct), ab(aad));
        expect(new Uint8Array(opened)).toEqual(pt);

        const theirs = await suite.seal({ recipientPublicKey, info: ab(info) }, ab(pt), ab(aad));
        expect(hpkeOpen(r.sk, new Uint8Array(theirs.enc), info, aad, new Uint8Array(theirs.ct))).toEqual(pt);
      }),
      { numRuns: 25 },
    );
  });
});

describe("HPKE failure cases", () => {
  it("wrong key, info, aad or tampered ciphertext → null", () => {
    const r = generateEncryptionKeyPair();
    const other = generateEncryptionKeyPair();
    const info = Uint8Array.of(1);
    const aad = Uint8Array.of(2);
    const s = hpkeSeal(r.pk, info, aad, Uint8Array.of(9, 9, 9));
    expect(hpkeOpen(r.sk, s.enc, info, aad, s.ct)).toEqual(Uint8Array.of(9, 9, 9));
    expect(hpkeOpen(other.sk, s.enc, info, aad, s.ct)).toBeNull();
    expect(hpkeOpen(r.sk, s.enc, Uint8Array.of(3), aad, s.ct)).toBeNull();
    expect(hpkeOpen(r.sk, s.enc, info, Uint8Array.of(3), s.ct)).toBeNull();
    const ct = s.ct.slice();
    ct[0]! ^= 1;
    expect(hpkeOpen(r.sk, s.enc, info, aad, ct)).toBeNull();
  });

  it("a low-order ephemeral key is rejected (all-zero DH)", () => {
    const r = generateEncryptionKeyPair();
    expect(hpkeOpen(r.sk, new Uint8Array(32), new Uint8Array(), new Uint8Array(), new Uint8Array(16))).toBeNull();
  });
});
