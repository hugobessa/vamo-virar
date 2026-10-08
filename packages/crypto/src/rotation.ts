// Membership key rotation (protocol.md §7.3), as run on an admin device.

import type { CborValue } from "@vamo-virar/protocol";
import { sealOp, type OpEnvelope } from "./envelope.js";
import { sealKeyEnvelope, type KeyEnvelope } from "./keyenv.js";
import { generateEpochKeys, type EpochKeys } from "./keys.js";
import { defaultRng, type Rng, type SigningKeyPair } from "./primitives.js";

export interface RotationInput {
  cid: Uint8Array;
  current: EpochKeys;
  admin: SigningKeyPair;
  /** MEK public keys of every member who should hold the new key, including this admin. */
  recipients: Uint8Array[];
  /** Encrypted body of the epoch.rotate op (§7.3 step 3): {reason, removed: [member_id]}. */
  body: CborValue;
  opId: Uint8Array;
  base: number;
  ts: number;
  rng?: Rng;
}

export interface Rotation {
  next: EpochKeys;
  /** Control-plane `rotate` op, sealed under the *current* epoch. */
  op: OpEnvelope;
  /** One per recipient, to post to their mailboxes once the op is accepted. */
  keyEnvelopes: KeyEnvelope[];
}

export function rotateEpoch(input: RotationInput): Rotation {
  const rng = input.rng ?? defaultRng;
  const next = generateEpochKeys(input.cid, input.current.epoch + 1, rng);
  const op = sealOp({
    cid: input.cid,
    opId: input.opId,
    epoch: input.current,
    author: input.admin,
    base: input.base,
    ts: input.ts,
    type: "epoch.rotate",
    body: input.body,
    control: { kind: "rotate", signer: input.admin, args: { new_epoch: next.epoch, eak: next.access.pk } },
    rng,
  });
  const keyEnvelopes = input.recipients.map((r) => sealKeyEnvelope(input.cid, next.epoch, next.key, r, { rng }));
  return { next, op, keyEnvelopes };
}
