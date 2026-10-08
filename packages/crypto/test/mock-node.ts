// A minimal in-memory community node implementing exactly the node-side
// checks of protocol.md §4.1 and §5, for end-to-end tests. Phase 3 replaces
// it with the Rust node; this mock defines the behaviour that node must match.

import { concatBytes, encode, equalBytes, toHex } from "@vamo-virar/protocol";
import {
  encodeEnvelope,
  entryHash,
  GENESIS_PREV,
  logEntryToCbor,
  verifyAccess,
  verifyControl,
  type LogEntry,
  type OpEnvelope,
} from "../src/envelope.js";
import type { HpkeSealed } from "../src/hpke.js";
import { communityId } from "../src/keys.js";
import { encodeKeyEnvelope, type KeyEnvelope } from "../src/keyenv.js";
import { snapshotEnvelopeToCbor, verifySnapshotAccess, type SnapshotEnvelope } from "../src/snapshot.js";

export type SubmitResult = { ok: true; seq: number } | { ok: false; error: string };

export class MockNode {
  readonly log: LogEntry[] = [];
  private head: Uint8Array = GENESIS_PREV;
  private epoch = 0;
  private readonly eaks = new Map<number, Uint8Array>();
  private adminSet: Uint8Array[] = [];
  private crk: Uint8Array | null = null;
  private readonly opIds = new Map<string, { seq: number; bytes: string }>();
  readonly mailboxes = new Map<string, KeyEnvelope[]>();
  readonly intake: HpkeSealed[] = [];
  snapshot: SnapshotEnvelope | null = null;
  /** When false, ops under the previous epoch are refused (grace window over). */
  graceOpen = true;
  now = Date.UTC(2026, 9, 1);

  constructor(readonly cid: Uint8Array) {}

  submit(env: OpEnvelope): SubmitResult {
    if (!equalBytes(env.cid, this.cid)) return { ok: false, error: "not_hosted" };

    const known = this.opIds.get(toHex(env.op_id));
    if (known) {
      return known.bytes === toHex(encodeEnvelope(env)) ? { ok: true, seq: known.seq } : { ok: false, error: "op_conflict" };
    }

    if (this.log.length === 0) {
      const c = env.ctrl;
      if (c?.kind !== "genesis") return { ok: false, error: "unauthorized" };
      if (!equalBytes(c.signer, c.args.crk) || !equalBytes(communityId(c.args.crk), this.cid)) {
        return { ok: false, error: "unauthorized" };
      }
      if (env.epoch !== 0 || !verifyControl(env) || !verifyAccess(env, c.args.eak)) {
        return { ok: false, error: "unauthorized" };
      }
      this.crk = c.args.crk;
      this.adminSet = c.args.admins;
      this.eaks.set(0, c.args.eak);
      return this.append(env);
    }

    const prevOk = this.graceOpen && env.epoch === this.epoch - 1 && env.plane === "d";
    if (env.epoch !== this.epoch && !prevOk) return { ok: false, error: "epoch_stale" };
    const eak = this.eaks.get(env.epoch);
    if (!eak || !verifyAccess(env, eak)) return { ok: false, error: "unauthorized" };

    if (env.ctrl) {
      const c = env.ctrl;
      if (!verifyControl(env)) return { ok: false, error: "unauthorized" };
      const isAdmin = this.adminSet.some((a) => equalBytes(a, c.signer));
      switch (c.kind) {
        case "genesis":
          return { ok: false, error: "unauthorized" };
        case "rotate":
          if (!isAdmin) return { ok: false, error: "unauthorized" };
          if (c.args.new_epoch !== this.epoch + 1) return { ok: false, error: "epoch_conflict" };
          this.epoch = c.args.new_epoch;
          this.eaks.set(this.epoch, c.args.eak);
          break;
        case "admin.set":
          if (!isAdmin && !equalBytes(c.signer, this.crk!)) return { ok: false, error: "unauthorized" };
          this.adminSet = c.args.admins;
          break;
      }
    }
    return this.append(env);
  }

  private append(env: OpEnvelope): SubmitResult {
    this.now += 60_000;
    const entry: LogEntry = { seq: this.log.length + 1, prev: this.head, env, at: this.now };
    this.log.push(entry);
    this.head = entryHash(entry);
    this.opIds.set(toHex(env.op_id), { seq: entry.seq, bytes: toHex(encodeEnvelope(env)) });
    return { ok: true, seq: entry.seq };
  }

  entriesAfter(seq: number): LogEntry[] {
    return this.log.slice(seq);
  }

  currentEak(): Uint8Array {
    return this.eaks.get(this.epoch)!;
  }

  post(mailbox: Uint8Array, env: KeyEnvelope): void {
    const k = toHex(mailbox);
    this.mailboxes.set(k, [...(this.mailboxes.get(k) ?? []), env]);
  }

  read(mailbox: Uint8Array): KeyEnvelope[] {
    return this.mailboxes.get(toHex(mailbox)) ?? [];
  }

  putSnapshot(s: SnapshotEnvelope): boolean {
    const eak = this.eaks.get(s.epoch);
    if (!eak || !verifySnapshotAccess(s, eak)) return false;
    this.snapshot = s;
    return true;
  }

  /** Everything an attacker gets by copying the node's database. */
  dump(): Uint8Array {
    const parts: Uint8Array[] = this.log.map((e) => encode(logEntryToCbor(e)));
    for (const items of this.mailboxes.values()) for (const k of items) parts.push(encodeKeyEnvelope(k));
    for (const s of this.intake) parts.push(s.enc, s.ct);
    if (this.snapshot) parts.push(encode(snapshotEnvelopeToCbor(this.snapshot)));
    return concatBytes(...parts);
  }
}
