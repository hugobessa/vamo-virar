// VV1 primitives (protocol.md §1.3) and context framing (§1.2).

import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { expand, extract } from "@noble/hashes/hkdf";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { concatBytes, encode, utf8, type CborValue } from "@vamo-virar/protocol";

export type Rng = (n: number) => Uint8Array;
export const defaultRng: Rng = (n) => randomBytes(n);

export interface SigningKeyPair {
  /** 32-byte Ed25519 seed. */
  sk: Uint8Array;
  pk: Uint8Array;
}

export interface EncryptionKeyPair {
  /** 32-byte X25519 scalar. */
  sk: Uint8Array;
  pk: Uint8Array;
}

// ---------------------------------------------------------------------------
// Context strings (protocol.md §15)
// ---------------------------------------------------------------------------

export const CTX = {
  communityId: "vv/community-id/v1",
  memberId: "vv/member-id/v1",
  mailboxId: "vv/mailbox-id/v1",
  opKey: "vv/op-key/v1",
  snapshotKey: "vv/snapshot-key/v1",
  epochAccess: "vv/epoch-access/v1",
  auth: "vv/auth/v1",
  opAccess: "vv/op-access/v1",
  opSig: "vv/op-sig/v1",
  ctrlSig: "vv/ctrl-sig/v1",
  logEntry: "vv/log-entry/v1",
  keyEnv: "vv/key-env/v1",
  join: "vv/join/v1",
  joinReq: "vv/join-req/v1",
  invite: "vv/invite/v1",
  state: "vv/state/v1",
  snapshotSig: "vv/snapshot-sig/v1",
  snapshotAccess: "vv/snapshot-access/v1",
  directory: "vv/directory/v1",
} as const;

/** Signature framing: ctx_len (1 byte) || ctx || cbor(value). */
export function frame(ctx: string, value: CborValue): Uint8Array {
  const c = utf8(ctx);
  if (c.length > 255) throw new Error("context too long");
  return concatBytes(Uint8Array.of(c.length), c, encode(value));
}

/** Hash framing: SHA-256(ctx || data). Used for identifiers and digests. */
export function hashCtx(ctx: string, ...data: Uint8Array[]): Uint8Array {
  return nobleSha256(concatBytes(utf8(ctx), ...data));
}

export const sha256 = nobleSha256;

// ---------------------------------------------------------------------------
// Ed25519
// ---------------------------------------------------------------------------

export function signingKeyPair(seed: Uint8Array): SigningKeyPair {
  if (seed.length !== 32) throw new Error("Ed25519 seed must be 32 bytes");
  return { sk: seed.slice(), pk: ed25519.getPublicKey(seed) };
}

export function generateSigningKeyPair(rng: Rng = defaultRng): SigningKeyPair {
  return signingKeyPair(rng(32));
}

export function sign(sk: Uint8Array, ctx: string, value: CborValue): Uint8Array {
  return ed25519.sign(frame(ctx, value), sk);
}

/**
 * Strict verification, matching ed25519-dalek's `verify_strict`: canonical
 * encodings, s < L, and neither the public key nor R may be of small order.
 */
export function verify(pk: Uint8Array, ctx: string, value: CborValue, sig: Uint8Array): boolean {
  if (pk.length !== 32 || sig.length !== 64) return false;
  try {
    if (!publicKeyOk(pk)) return false;
    if (ed25519.Point.fromHex(sig.subarray(0, 32)).isSmallOrder()) return false;
    return ed25519.verify(sig, frame(ctx, value), pk, { zip215: false });
  } catch {
    return false;
  }
}

// Public keys repeat constantly (the epoch access key, members' keys), and the
// small-order check costs a point decompression, so remember keys that passed.
const OK_KEYS = new Set<string>();
const OK_KEYS_MAX = 4096;

function publicKeyOk(pk: Uint8Array): boolean {
  let k = "";
  for (const b of pk) k += String.fromCharCode(b);
  if (OK_KEYS.has(k)) return true;
  if (ed25519.Point.fromHex(pk).isSmallOrder()) return false;
  if (OK_KEYS.size >= OK_KEYS_MAX) OK_KEYS.clear();
  OK_KEYS.add(k);
  return true;
}

// ---------------------------------------------------------------------------
// X25519
// ---------------------------------------------------------------------------

export function encryptionKeyPair(sk: Uint8Array): EncryptionKeyPair {
  if (sk.length !== 32) throw new Error("X25519 key must be 32 bytes");
  return { sk: sk.slice(), pk: x25519.getPublicKey(sk) };
}

export function generateEncryptionKeyPair(rng: Rng = defaultRng): EncryptionKeyPair {
  return encryptionKeyPair(rng(32));
}

/** X25519 with the all-zero output check required by RFC 9180 §7.1.4. */
export function dh(sk: Uint8Array, pk: Uint8Array): Uint8Array {
  const out = x25519.getSharedSecret(sk, pk);
  let acc = 0;
  for (const b of out) acc |= b;
  if (acc === 0) throw new Error("X25519 produced the all-zero shared secret");
  return out;
}

// ---------------------------------------------------------------------------
// HKDF-SHA256
// ---------------------------------------------------------------------------

export function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Uint8Array {
  return extract(nobleSha256, ikm, salt);
}

export function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  return expand(nobleSha256, prk, info, length);
}

export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length = 32): Uint8Array {
  return hkdfExpand(hkdfExtract(salt, ikm), info, length);
}

// ---------------------------------------------------------------------------
// XChaCha20-Poly1305
// ---------------------------------------------------------------------------

export const XNONCE_BYTES = 24;

export function aeadSeal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  return xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
}

/** Returns null on authentication failure. */
export function aeadOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Uint8Array | null {
  try {
    return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  } catch {
    return null;
  }
}
