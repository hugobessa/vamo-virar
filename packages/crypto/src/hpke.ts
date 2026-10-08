// HPKE (RFC 9180), base mode, single-shot, for exactly one suite:
//   KEM  DHKEM(X25519, HKDF-SHA256)  0x0020
//   KDF  HKDF-SHA256                 0x0001
//   AEAD ChaCha20Poly1305            0x0003
//
// Built on the same noble primitives as the rest of the package so React
// Native needs no WebCrypto. Interoperability with an independent
// implementation (hpke-js) and with the Rust `hpke` crate is tested.

import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519";
import { concatBytes, utf8 } from "@vamo-virar/protocol";
import { defaultRng, dh, hkdfExpand, hkdfExtract, type EncryptionKeyPair, type Rng } from "./primitives.js";

const KEM_ID = 0x0020;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0003;
const MODE_BASE = 0x00;
const N_SECRET = 32;
const N_K = 32;
const N_N = 12;

const i2osp2 = (n: number) => Uint8Array.of(n >> 8, n & 0xff);
const HPKE_V1 = utf8("HPKE-v1");
const SUITE_KEM = concatBytes(utf8("KEM"), i2osp2(KEM_ID));
const SUITE_HPKE = concatBytes(utf8("HPKE"), i2osp2(KEM_ID), i2osp2(KDF_ID), i2osp2(AEAD_ID));
const EMPTY = new Uint8Array(0);

function labeledExtract(suite: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array): Uint8Array {
  return hkdfExtract(salt, concatBytes(HPKE_V1, suite, utf8(label), ikm));
}

function labeledExpand(suite: Uint8Array, prk: Uint8Array, label: string, info: Uint8Array, len: number): Uint8Array {
  return hkdfExpand(prk, concatBytes(i2osp2(len), HPKE_V1, suite, utf8(label), info), len);
}

/** RFC 9180 §7.1.3 DeriveKeyPair for X25519. */
export function deriveKeyPair(ikm: Uint8Array): EncryptionKeyPair {
  const prk = labeledExtract(SUITE_KEM, EMPTY, "dkp_prk", ikm);
  const sk = labeledExpand(SUITE_KEM, prk, "sk", EMPTY, 32);
  return { sk, pk: x25519.getPublicKey(sk) };
}

function extractAndExpand(dhOut: Uint8Array, kemContext: Uint8Array): Uint8Array {
  const prk = labeledExtract(SUITE_KEM, EMPTY, "eae_prk", dhOut);
  return labeledExpand(SUITE_KEM, prk, "shared_secret", kemContext, N_SECRET);
}

function keySchedule(sharedSecret: Uint8Array, info: Uint8Array): { key: Uint8Array; nonce: Uint8Array } {
  const pskIdHash = labeledExtract(SUITE_HPKE, EMPTY, "psk_id_hash", EMPTY);
  const infoHash = labeledExtract(SUITE_HPKE, EMPTY, "info_hash", info);
  const ctx = concatBytes(Uint8Array.of(MODE_BASE), pskIdHash, infoHash);
  const secret = labeledExtract(SUITE_HPKE, sharedSecret, "secret", EMPTY);
  return {
    key: labeledExpand(SUITE_HPKE, secret, "key", ctx, N_K),
    nonce: labeledExpand(SUITE_HPKE, secret, "base_nonce", ctx, N_N),
  };
}

export interface HpkeSealed {
  enc: Uint8Array;
  ct: Uint8Array;
}

export interface SealOptions {
  rng?: Rng;
  /** Test vectors only: derive the ephemeral key from this IKM. */
  ikmE?: Uint8Array;
}

export function hpkeSeal(
  pkR: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
  opts: SealOptions = {},
): HpkeSealed {
  const eph = deriveKeyPair(opts.ikmE ?? (opts.rng ?? defaultRng)(32));
  const shared = extractAndExpand(dh(eph.sk, pkR), concatBytes(eph.pk, pkR));
  const { key, nonce } = keySchedule(shared, info);
  return { enc: eph.pk, ct: chacha20poly1305(key, nonce, aad).encrypt(plaintext) };
}

/** Returns null if the ciphertext does not open under this key. */
export function hpkeOpen(
  skR: Uint8Array,
  enc: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  ct: Uint8Array,
): Uint8Array | null {
  if (enc.length !== 32) return null;
  try {
    const pkR = x25519.getPublicKey(skR);
    const shared = extractAndExpand(dh(skR, enc), concatBytes(enc, pkR));
    const { key, nonce } = keySchedule(shared, info);
    return chacha20poly1305(key, nonce, aad).decrypt(ct);
  } catch {
    return null;
  }
}
