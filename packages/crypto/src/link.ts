// Linking a device (protocol.md §10.5.5): the keys travel from one of the
// person's devices to a new one through a throwaway mailbox on the node,
// sealed under a key derived from a random secret (in the link) and a short
// code (shown on the source's screen, typed on the new device when the link
// was copied rather than scanned).

import { argon2idAsync } from "@noble/hashes/argon2";
import { concatBytes, utf8 } from "@vamo-virar/protocol";
import { mailboxId } from "./keys.js";
import { aeadOpen, aeadSeal, CTX, defaultRng, hkdf, signingKeyPair, XNONCE_BYTES, type Rng, type SigningKeyPair } from "./primitives.js";

/** Crockford base32: no I, L, O or U, so the code survives being read aloud or retyped. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LINK_CODE_CHARS = 10; // 50 bits
export const LINK_SECRET_BYTES = 32;

/** Argon2id cost (§10.5.5): the OWASP minimum. */
export const LINK_ARGON2 = { m: 19 * 1024, t: 2, p: 1 } as const;

export function generateLinkCode(rng: Rng = defaultRng): string {
  // 7 bytes = 56 bits; keep 50.
  const b = rng(7);
  let bits = 0n;
  for (const x of b) bits = (bits << 8n) | BigInt(x);
  let out = "";
  for (let i = 0; i < LINK_CODE_CHARS; i++) out += ALPHABET[Number((bits >> BigInt(5 * i)) & 31n)];
  return out;
}

/** Undoes what typing does to a code: case, separators, and the letters Crockford folds. Null if it is not a code. */
export function normalizeLinkCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (s.length !== LINK_CODE_CHARS) return null;
  for (const c of s) if (!ALPHABET.includes(c)) return null;
  return s;
}

/** `K7QM-2XRA-9P`: groups of four, for reading off one screen and typing on another. */
export function formatLinkCode(code: string): string {
  return code.match(/.{1,4}/g)!.join("-");
}

/** The throwaway mailbox both devices can open with the link's secret. */
export function linkRendezvous(cid: Uint8Array, secret: Uint8Array): { key: SigningKeyPair; mailbox: Uint8Array } {
  const key = signingKeyPair(hkdf(secret, cid, utf8(CTX.linkMailbox)));
  return { key, mailbox: mailboxId(cid, key.pk) };
}

/** The key that opens the bundle. Deliberately slow (Argon2id over the code). */
export async function linkKey(cid: Uint8Array, secret: Uint8Array, code: string): Promise<Uint8Array> {
  const norm = normalizeLinkCode(code);
  if (!norm) throw new Error("not a link code");
  const salt = hkdf(secret, cid, utf8(CTX.linkSalt), 16);
  const stretched = await argon2idAsync(utf8(norm), salt, { ...LINK_ARGON2, dkLen: 32 });
  return hkdf(concatBytes(secret, stretched), cid, utf8(CTX.linkKey));
}

const aad = (cid: Uint8Array) => concatBytes(utf8(CTX.link), cid);

/** nonce(24) || XChaCha20-Poly1305 ciphertext. */
export function sealLinkBundle(key: Uint8Array, cid: Uint8Array, plaintext: Uint8Array, rng: Rng = defaultRng): Uint8Array {
  const nonce = rng(XNONCE_BYTES);
  return concatBytes(nonce, aeadSeal(key, nonce, plaintext, aad(cid)));
}

/** Null when the code was wrong or the bytes were changed. */
export function openLinkBundle(key: Uint8Array, cid: Uint8Array, sealed: Uint8Array): Uint8Array | null {
  if (sealed.length < XNONCE_BYTES + 16) return null;
  return aeadOpen(key, sealed.subarray(0, XNONCE_BYTES), sealed.subarray(XNONCE_BYTES), aad(cid));
}
