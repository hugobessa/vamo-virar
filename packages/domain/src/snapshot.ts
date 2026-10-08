// Snapshots (protocol.md §12). Retention runs inside the reducer, so a
// snapshot is exactly the reducer state at `seq`, minus the device-local
// op_id index. Restoring a snapshot and replaying the tail therefore yields
// the same state as replaying the whole log.

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { CommunityState } from "./types.js";
import { canonicalJson, clone } from "./util.js";

export type SnapshotState = Omit<CommunityState, "op_ids">;

export interface Snapshot {
  seq: number;
  state: SnapshotState;
  /** Fingerprint of `state`; see `stateHash`. */
  state_hash: string;
}

export function createSnapshot(state: CommunityState): Snapshot {
  const { op_ids: _ignored, ...rest } = clone(state);
  return { seq: rest.clock.seq, state: rest, state_hash: stateHash(rest) };
}

export function restoreSnapshot(snapshot: Snapshot): CommunityState {
  if (snapshot.state.clock.seq !== snapshot.seq) throw new Error("snapshot seq mismatch");
  if (stateHash(snapshot.state) !== snapshot.state_hash) throw new Error("snapshot state_hash mismatch");
  return { ...clone(snapshot.state), op_ids: {} };
}

/**
 * SHA-256("vv/state/v1" || canonical(state)). Provisional: canonical JSON
 * stands in for deterministic CBOR until the protocol package lands, so this
 * hash is not yet wire-compatible with the Rust side.
 */
export function stateHash(state: CommunityState | SnapshotState): string {
  const { op_ids: _ignored, ...rest } = state as CommunityState;
  return bytesToHex(sha256(utf8ToBytes(`vv/state/v1${canonicalJson(rest)}`)));
}
