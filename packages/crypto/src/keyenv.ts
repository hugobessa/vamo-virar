// Key envelopes (protocol.md §7.1): K_epoch sealed to one member's MEK.

import { concatBytes, decode, encode, u32be, utf8, type CborValue } from "@vamo-virar/protocol";
import { hpkeOpen, hpkeSeal, type SealOptions } from "./hpke.js";
import { CTX, type EncryptionKeyPair } from "./primitives.js";
import { asBytes, asMap, asUint, U32_MAX, type CborMap } from "./wire.js";

export interface KeyEnvelope {
  cid: Uint8Array;
  epoch: number;
  recipient: Uint8Array; // MEK.public
  enc: Uint8Array;
  ct: Uint8Array;
}

const info = (cid: Uint8Array, epoch: number) => concatBytes(utf8(CTX.keyEnv), cid, u32be(epoch));
const aad = (cid: Uint8Array, epoch: number, recipient: Uint8Array) => encode({ cid, epoch, recipient });

export function sealKeyEnvelope(
  cid: Uint8Array,
  epoch: number,
  key: Uint8Array,
  recipient: Uint8Array,
  opts?: SealOptions,
): KeyEnvelope {
  const { enc, ct } = hpkeSeal(recipient, info(cid, epoch), aad(cid, epoch, recipient), key, opts);
  return { cid, epoch, recipient, enc, ct };
}

/** Returns K_epoch, or null if this envelope is not for `me` or was tampered with. */
export function openKeyEnvelope(env: KeyEnvelope, me: EncryptionKeyPair): Uint8Array | null {
  const key = hpkeOpen(me.sk, env.enc, info(env.cid, env.epoch), aad(env.cid, env.epoch, me.pk), env.ct);
  return key && key.length === 32 ? key : null;
}

export function keyEnvelopeToCbor(e: KeyEnvelope): CborMap {
  return { cid: e.cid, epoch: e.epoch, recipient: e.recipient, enc: e.enc, ct: e.ct };
}

export function keyEnvelopeFromCbor(v: CborValue): KeyEnvelope {
  const m = asMap(v, ["cid", "epoch", "recipient", "enc", "ct"]);
  return {
    cid: asBytes(m.cid, 32),
    epoch: asUint(m.epoch, U32_MAX),
    recipient: asBytes(m.recipient, 32),
    enc: asBytes(m.enc, 32),
    ct: asBytes(m.ct, 48),
  };
}

export const encodeKeyEnvelope = (e: KeyEnvelope) => encode(keyEnvelopeToCbor(e));
export const decodeKeyEnvelope = (b: Uint8Array) => keyEnvelopeFromCbor(decode(b));
