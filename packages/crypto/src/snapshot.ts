// Encrypted, signed snapshots (protocol.md §12.1).

import { stateHash, type SnapshotState } from "@vamo-virar/domain";
import { decode, encode, equalBytes, fromHex, type CborValue } from "@vamo-virar/protocol";
import type { EpochKeys } from "./keys.js";
import {
  aeadOpen,
  aeadSeal,
  CTX,
  defaultRng,
  sign,
  verify,
  XNONCE_BYTES,
  type Rng,
  type SigningKeyPair,
} from "./primitives.js";
import { asBytes, asMap, asUint, U32_MAX, type CborMap } from "./wire.js";

export interface SnapshotEnvelope {
  cid: Uint8Array;
  seq: number;
  head: Uint8Array; // entry_hash of log entry `seq`
  epoch: number;
  nonce: Uint8Array;
  ct: Uint8Array;
  asig: Uint8Array;
}

export interface OpenedSnapshot {
  seq: number;
  head: Uint8Array;
  epoch: number;
  state: SnapshotState;
  /** MSK.public of the producer. The caller MUST check it was an admin at `seq`. */
  author: Uint8Array;
}

const header = (e: Pick<SnapshotEnvelope, "cid" | "seq" | "head" | "epoch">): CborMap => ({
  cid: e.cid,
  seq: e.seq,
  head: e.head,
  epoch: e.epoch,
});

export function sealSnapshot(input: {
  cid: Uint8Array;
  head: Uint8Array;
  state: SnapshotState;
  epoch: EpochKeys;
  author: SigningKeyPair;
  rng?: Rng;
}): SnapshotEnvelope {
  const rng = input.rng ?? defaultRng;
  const seq = input.state.clock.seq;
  const h = header({ cid: input.cid, seq, head: input.head, epoch: input.epoch.epoch });
  const unsigned: CborMap = {
    ...h,
    state: input.state as unknown as CborValue,
    state_hash: fromHex(stateHash(input.state)),
    author: input.author.pk,
  };
  const pt = encode({ ...unsigned, sig: sign(input.author.sk, CTX.snapshotSig, unsigned) });
  const nonce = rng(XNONCE_BYTES);
  const ct = aeadSeal(input.epoch.snapshotKey, nonce, pt, encode(h));
  const asig = sign(input.epoch.access.sk, CTX.snapshotAccess, { ...h, nonce, ct });
  return { cid: input.cid, seq, head: input.head, epoch: input.epoch.epoch, nonce, ct, asig };
}

export function verifySnapshotAccess(env: SnapshotEnvelope, eak: Uint8Array): boolean {
  return verify(eak, CTX.snapshotAccess, { ...header(env), nonce: env.nonce, ct: env.ct }, env.asig);
}

/** Decrypts and verifies; null on any failure. */
export function openSnapshot(env: SnapshotEnvelope, keys: EpochKeys): OpenedSnapshot | null {
  if (keys.epoch !== env.epoch || !verifySnapshotAccess(env, keys.access.pk)) return null;
  const h = header(env);
  const pt = aeadOpen(keys.snapshotKey, env.nonce, env.ct, encode(h));
  if (!pt) return null;
  try {
    const m = asMap(decode(pt), ["cid", "seq", "head", "epoch", "state", "state_hash", "author", "sig"]);
    if (
      !equalBytes(asBytes(m.cid, 32), env.cid) ||
      asUint(m.seq) !== env.seq ||
      !equalBytes(asBytes(m.head, 32), env.head) ||
      asUint(m.epoch, U32_MAX) !== env.epoch
    ) {
      return null;
    }
    const author = asBytes(m.author, 32);
    const { sig, ...unsigned } = m;
    if (!verify(author, CTX.snapshotSig, unsigned, asBytes(sig, 64))) return null;
    const state = m.state as unknown as SnapshotState;
    if (!equalBytes(fromHex(stateHash(state)), asBytes(m.state_hash, 32))) return null;
    if (state.clock?.seq !== env.seq) return null;
    return { seq: env.seq, head: env.head, epoch: env.epoch, state, author };
  } catch {
    return null;
  }
}

export function snapshotEnvelopeToCbor(e: SnapshotEnvelope): CborMap {
  return { ...header(e), nonce: e.nonce, ct: e.ct, asig: e.asig };
}

export function snapshotEnvelopeFromCbor(v: CborValue): SnapshotEnvelope {
  const m = asMap(v, ["cid", "seq", "head", "epoch", "nonce", "ct", "asig"]);
  return {
    cid: asBytes(m.cid, 32),
    seq: asUint(m.seq),
    head: asBytes(m.head, 32),
    epoch: asUint(m.epoch, U32_MAX),
    nonce: asBytes(m.nonce, XNONCE_BYTES),
    ct: asBytes(m.ct),
    asig: asBytes(m.asig, 64),
  };
}
