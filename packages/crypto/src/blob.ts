// Attachments (protocol.md §9.7, §15 `/blobs`): a file is sealed under a
// fresh random key on the device and stored on the node as opaque bytes named
// by the SHA-256 of the ciphertext. The key and nonce travel only inside the
// (encrypted) task op that references the blob, so the node learns a size and
// nothing else, and rotating the community key never needs to re-encrypt files.

import { equalBytes, utf8 } from "@vamo-virar/protocol";
import { aeadOpen, aeadSeal, defaultRng, sha256, XNONCE_BYTES, type Rng } from "./primitives.js";

export const BLOB_CTX = "vv/blob/v1";
const AAD = utf8(BLOB_CTX);

/** Plaintext cap, matched by the reducer's `TASK_LIMITS.attachmentBytes`. */
export const MAX_BLOB_PLAINTEXT = 10 * 1024 * 1024;

export interface SealedBlob {
  key: Uint8Array;
  nonce: Uint8Array;
  ct: Uint8Array;
  /** SHA-256 of `ct`: the blob's name on the node. */
  blobId: Uint8Array;
}

export function blobIdOf(ct: Uint8Array): Uint8Array {
  return sha256(ct);
}

export function sealBlob(plaintext: Uint8Array, rng: Rng = defaultRng): SealedBlob {
  if (plaintext.length > MAX_BLOB_PLAINTEXT) throw new Error("attachment is too large");
  const key = rng(32);
  const nonce = rng(XNONCE_BYTES);
  const ct = aeadSeal(key, nonce, plaintext, AAD);
  return { key, nonce, ct, blobId: blobIdOf(ct) };
}

/**
 * Checks the bytes the node returned are the blob the task named, then
 * decrypts. Null when either fails: a wrong file, a tampered one, or a key
 * that does not belong to it.
 */
export function openBlob(ref: { key: Uint8Array; nonce: Uint8Array; blobId: Uint8Array }, ct: Uint8Array): Uint8Array | null {
  if (!equalBytes(blobIdOf(ct), ref.blobId)) return null;
  return aeadOpen(ref.key, ref.nonce, ct, AAD);
}
