// Key inventory and derivations (protocol.md §2).

import { concatBytes, u32be, utf8 } from "@vamo-virar/protocol";
import {
  CTX,
  defaultRng,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  hashCtx,
  hkdf,
  signingKeyPair,
  type EncryptionKeyPair,
  type Rng,
  type SigningKeyPair,
} from "./primitives.js";

/** A device's keys for one community membership (§2.1, per-community). */
export interface MemberKeys {
  signing: SigningKeyPair; // MSK
  encryption: EncryptionKeyPair; // MEK
}

export function generateMemberKeys(rng: Rng = defaultRng): MemberKeys {
  return { signing: generateSigningKeyPair(rng), encryption: generateEncryptionKeyPair(rng) };
}

/** community_id = SHA-256("vv/community-id/v1" || CRK.public). */
export function communityId(crk: Uint8Array): Uint8Array {
  return hashCtx(CTX.communityId, crk);
}

/** member_id = SHA-256("vv/member-id/v1" || MSK.public). */
export function memberId(msk: Uint8Array): Uint8Array {
  return hashCtx(CTX.memberId, msk);
}

/** mailbox_id = SHA-256("vv/mailbox-id/v1" || community_id || MSK.public). */
export function mailboxId(cid: Uint8Array, msk: Uint8Array): Uint8Array {
  return hashCtx(CTX.mailboxId, cid, msk);
}

/** Everything derived from one epoch key K_e (§2.3). */
export interface EpochKeys {
  epoch: number;
  /** K_e itself — what key envelopes carry. */
  key: Uint8Array;
  opKey: Uint8Array;
  snapshotKey: Uint8Array;
  /** EAK_e: the group credential the node authenticates. */
  access: SigningKeyPair;
}

export function deriveEpochKeys(cid: Uint8Array, epoch: number, key: Uint8Array): EpochKeys {
  if (key.length !== 32) throw new Error("epoch key must be 32 bytes");
  const salt = concatBytes(cid, u32be(epoch));
  return {
    epoch,
    key: key.slice(),
    opKey: hkdf(key, salt, utf8(CTX.opKey)),
    snapshotKey: hkdf(key, salt, utf8(CTX.snapshotKey)),
    access: signingKeyPair(hkdf(key, salt, utf8(CTX.epochAccess))),
  };
}

export function generateEpochKeys(cid: Uint8Array, epoch: number, rng: Rng = defaultRng): EpochKeys {
  return deriveEpochKeys(cid, epoch, rng(32));
}

/** Holds every epoch key a device knows, for opening older entries. */
export class Keyring {
  private readonly epochs = new Map<number, EpochKeys>();

  constructor(readonly cid: Uint8Array) {}

  add(keys: EpochKeys): void {
    this.epochs.set(keys.epoch, keys);
  }

  addKey(epoch: number, key: Uint8Array): EpochKeys {
    const k = deriveEpochKeys(this.cid, epoch, key);
    this.add(k);
    return k;
  }

  get(epoch: number): EpochKeys | undefined {
    return this.epochs.get(epoch);
  }

  latest(): EpochKeys | undefined {
    let best: EpochKeys | undefined;
    for (const k of this.epochs.values()) if (!best || k.epoch > best.epoch) best = k;
    return best;
  }
}

export interface CommunityRoot {
  crk: SigningKeyPair;
  cid: Uint8Array;
}

export function generateCommunityRoot(rng: Rng = defaultRng): CommunityRoot {
  const crk = generateSigningKeyPair(rng);
  return { crk, cid: communityId(crk.pk) };
}
