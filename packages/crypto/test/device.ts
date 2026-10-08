// A test device: keys, keyring, log verifier and domain state, wired together
// the way the mobile app's sync engine will be (Phase 4).

import { applyInPlace, DEFAULT_POLICY, genesis, restoreSnapshot, stateHash, type CommunityState, type Outcome } from "@vamo-virar/domain";
import { toHex, type CborValue } from "@vamo-virar/protocol";
import { LogVerifier, sealOp } from "../src/envelope.js";
import { sealJoinRequest } from "../src/intake.js";
import { openKeyEnvelope } from "../src/keyenv.js";
import {
  generateCommunityRoot,
  generateEpochKeys,
  generateMemberKeys,
  Keyring,
  mailboxId,
  memberId,
  type EpochKeys,
  type MemberKeys,
} from "../src/keys.js";
import { generateEncryptionKeyPair, type EncryptionKeyPair, type Rng } from "../src/primitives.js";
import type { OpenedSnapshot } from "../src/snapshot.js";
import type { MockNode, SubmitResult } from "./mock-node.js";

export class Device {
  readonly keys: MemberKeys;
  readonly keyring: Keyring;
  verifier: LogVerifier;
  state: CommunityState | null = null;
  readonly outcomes: Outcome[] = [];
  /** Admin devices hold the intake key's private half. */
  ik?: EncryptionKeyPair;

  constructor(
    readonly name: string,
    readonly cid: Uint8Array,
    readonly rng: Rng,
  ) {
    this.keys = generateMemberKeys(rng);
    this.keyring = new Keyring(cid);
    this.verifier = new LogVerifier(cid, this.keyring);
  }

  get id(): string {
    return toHex(memberId(this.keys.signing.pk));
  }

  get mailbox(): Uint8Array {
    return mailboxId(this.cid, this.keys.signing.pk);
  }

  profile(): CborValue {
    return { display_name: this.name };
  }

  checkMail(node: MockNode): void {
    for (const env of node.read(this.mailbox)) {
      const k = openKeyEnvelope(env, this.keys.encryption);
      if (k && !this.keyring.get(env.epoch)) this.keyring.addKey(env.epoch, k);
    }
  }

  sync(node: MockNode): void {
    for (const e of node.entriesAfter(this.verifier.seq)) {
      const entry = this.verifier.ingest(e);
      if (!this.state) {
        this.state = genesis(entry);
        this.outcomes.push({ status: "applied" });
      } else {
        this.outcomes.push(applyInPlace(this.state, entry));
      }
    }
  }

  write(node: MockNode, type: string, body: CborValue, epoch?: EpochKeys): SubmitResult {
    const keys = epoch ?? this.keyring.latest();
    if (!keys) throw new Error(`${this.name} holds no epoch key`);
    return node.submit(
      sealOp({
        cid: this.cid,
        opId: this.rng(16),
        epoch: keys,
        author: this.keys.signing,
        base: this.verifier.seq,
        ts: 0,
        type,
        body,
        rng: this.rng,
      }),
    );
  }

  requestToJoin(node: MockNode, ik: Uint8Array): void {
    node.intake.push(sealJoinRequest(ik, this.keys, { cid: this.cid, profile: this.profile() }, { rng: this.rng }));
  }

  /** Bootstraps from a verified snapshot instead of genesis (§7.6, §12). */
  restore(snap: OpenedSnapshot): void {
    this.state = restoreSnapshot({ seq: snap.seq, state: snap.state, state_hash: stateHash(snap.state) });
    const eaks = new Map<number, Uint8Array>();
    const k = this.keyring.get(snap.epoch);
    if (k) eaks.set(snap.epoch, k.access.pk);
    this.verifier = new LogVerifier(this.cid, this.keyring, { seq: snap.seq, head: snap.head, eaks });
  }
}

/** Founder flow: CRK, epoch 0, intake key, genesis op. Returns the founder's device. */
export function foundCommunity(name: string, rng: Rng, node: (cid: Uint8Array) => MockNode) {
  const root = generateCommunityRoot(rng);
  const founder = new Device(name, root.cid, rng);
  const k0 = generateEpochKeys(root.cid, 0, rng);
  founder.keyring.add(k0);
  founder.ik = generateEncryptionKeyPair(rng);
  const n = node(root.cid);
  const res = n.submit(
    sealOp({
      cid: root.cid,
      opId: rng(16),
      epoch: k0,
      author: founder.keys.signing,
      base: 0,
      ts: 0,
      type: "community.init",
      body: {
        name: "Coletivo Recife",
        description: "",
        policy: DEFAULT_POLICY as unknown as CborValue,
        founders: [{ msk: toHex(founder.keys.signing.pk), mek: toHex(founder.keys.encryption.pk), profile: founder.profile() }],
      },
      control: {
        kind: "genesis",
        signer: root.crk,
        args: { suite: "VV1", crk: root.crk.pk, admins: [founder.keys.signing.pk], eak: k0.access.pk, ik: founder.ik.pk },
      },
      rng,
    }),
  );
  if (!res.ok) throw new Error(`genesis refused: ${res.error}`);
  founder.sync(n);
  return { root, founder, node: n, k0 };
}
