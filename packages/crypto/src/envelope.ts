// Operation envelopes, control headers and log entries (protocol.md §4, §5).

import type { ControlHeader as DomainControl, DecodedOp, Entry } from "@vamo-virar/domain";
import { decode, encode, equalBytes, toHex, type CborValue } from "@vamo-virar/protocol";
import type { EpochKeys, Keyring } from "./keys.js";
import {
  aeadOpen,
  aeadSeal,
  CTX,
  defaultRng,
  hashCtx,
  sign,
  verify,
  XNONCE_BYTES,
  type Rng,
  type SigningKeyPair,
} from "./primitives.js";
import { asArray, asBytes, asMap, asText, asUint, optional, U32_MAX, WireError, type CborMap } from "./wire.js";

export const ENVELOPE_VERSION = 1;
export const MAX_OP_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ControlArgs =
  | {
      kind: "genesis";
      args: { suite: "VV1"; crk: Uint8Array; admins: Uint8Array[]; eak: Uint8Array; ik: Uint8Array };
    }
  | { kind: "rotate"; args: { new_epoch: number; eak: Uint8Array } }
  | { kind: "admin.set"; args: { admins: Uint8Array[]; ik?: Uint8Array } }
  /** Where the community lives from now on (§11.3). Empty cancels a move. */
  | { kind: "migrate"; args: { nodes: string[] } };

export type ControlHeader = ControlArgs & { signer: Uint8Array; csig: Uint8Array };

export interface OpEnvelope {
  v: 1;
  cid: Uint8Array;
  op_id: Uint8Array;
  epoch: number;
  plane: "d" | "c";
  ctrl?: ControlHeader;
  nonce: Uint8Array;
  ct: Uint8Array;
  asig: Uint8Array;
}

export interface LogEntry {
  seq: number;
  prev: Uint8Array;
  env: OpEnvelope;
  at: number;
}

export interface OpenedOp {
  author: Uint8Array;
  base: number;
  ts: number;
  type: string;
  body: CborValue;
}

export type OpenResult =
  | { ok: true; op: OpenedOp }
  | { ok: false; problem: "no_key" | "undecryptable" | "malformed" | "binding_mismatch" | "bad_signature" };

export const GENESIS_PREV = new Uint8Array(32);

// ---------------------------------------------------------------------------
// CBOR mapping
// ---------------------------------------------------------------------------

function argsToCbor(c: ControlArgs): CborValue {
  switch (c.kind) {
    case "genesis":
      return { ...c.args, admins: [...c.args.admins] };
    case "rotate":
      return { ...c.args };
    case "admin.set":
      return { admins: [...c.args.admins], ik: c.args.ik };
    case "migrate":
      return { nodes: [...c.args.nodes] };
  }
}

function controlToCbor(c: ControlHeader): CborValue {
  return { kind: c.kind, signer: c.signer, csig: c.csig, args: argsToCbor(c) };
}

function headerToCbor(env: Omit<OpEnvelope, "nonce" | "ct" | "asig">): CborMap {
  return {
    v: env.v,
    cid: env.cid,
    op_id: env.op_id,
    epoch: env.epoch,
    plane: env.plane,
    ctrl: env.ctrl ? controlToCbor(env.ctrl) : undefined,
  };
}

export function envelopeToCbor(env: OpEnvelope): CborMap {
  return { ...headerToCbor(env), nonce: env.nonce, ct: env.ct, asig: env.asig };
}

function keyList(v: CborValue | undefined): Uint8Array[] {
  const list = asArray(v, 64).map((k) => asBytes(k, 32));
  if (list.length === 0) throw new WireError("empty key list");
  return list;
}

export const MAX_NODES = 5;
export const MAX_NODE_URL = 200;

/** `migrate` targets: up to five http(s) base URLs of printable ASCII. */
export function nodeList(v: CborValue | undefined): string[] {
  return asArray(v, MAX_NODES).map((n) => {
    const url = asText(n, MAX_NODE_URL);
    if (!/^https?:\/\/[\x21-\x7e]+$/.test(url)) throw new WireError("bad node url");
    return url;
  });
}

function controlFromCbor(v: CborValue): ControlHeader {
  const m = asMap(v, ["kind", "signer", "csig", "args"]);
  const signer = asBytes(m.signer, 32);
  const csig = asBytes(m.csig, 64);
  const kind = asText(m.kind, 16);
  switch (kind) {
    case "genesis": {
      const a = asMap(m.args, ["suite", "crk", "admins", "eak", "ik"]);
      if (a.suite !== "VV1") throw new WireError("unsupported suite");
      return {
        kind,
        signer,
        csig,
        args: { suite: "VV1", crk: asBytes(a.crk, 32), admins: keyList(a.admins), eak: asBytes(a.eak, 32), ik: asBytes(a.ik, 32) },
      };
    }
    case "rotate": {
      const a = asMap(m.args, ["new_epoch", "eak"]);
      return { kind, signer, csig, args: { new_epoch: asUint(a.new_epoch, U32_MAX), eak: asBytes(a.eak, 32) } };
    }
    case "admin.set": {
      const a = asMap(m.args, ["admins", "ik"]);
      const ik = optional(a.ik, (x) => asBytes(x, 32));
      return { kind, signer, csig, args: ik ? { admins: keyList(a.admins), ik } : { admins: keyList(a.admins) } };
    }
    case "migrate": {
      const a = asMap(m.args, ["nodes"]);
      return { kind, signer, csig, args: { nodes: nodeList(a.nodes) } };
    }
    default:
      throw new WireError(`unknown control kind ${kind}`);
  }
}

export function envelopeFromCbor(v: CborValue): OpEnvelope {
  const m = asMap(v, ["v", "cid", "op_id", "epoch", "plane", "ctrl", "nonce", "ct", "asig"]);
  if (m.v !== ENVELOPE_VERSION) throw new WireError("unsupported envelope version");
  const plane = m.plane;
  if (plane !== "d" && plane !== "c") throw new WireError("bad plane");
  const ctrl = optional(m.ctrl, controlFromCbor);
  if ((plane === "c") !== (ctrl !== undefined)) throw new WireError("ctrl must be present iff plane is c");
  const env: OpEnvelope = {
    v: 1,
    cid: asBytes(m.cid, 32),
    op_id: asBytes(m.op_id, 16),
    epoch: asUint(m.epoch, U32_MAX),
    plane,
    nonce: asBytes(m.nonce, XNONCE_BYTES),
    ct: asBytes(m.ct),
    asig: asBytes(m.asig, 64),
  };
  if (ctrl) env.ctrl = ctrl;
  return env;
}

export function encodeEnvelope(env: OpEnvelope): Uint8Array {
  return encode(envelopeToCbor(env));
}

export function decodeEnvelope(bytes: Uint8Array): OpEnvelope {
  if (bytes.length > MAX_OP_BYTES) throw new WireError("envelope too large");
  return envelopeFromCbor(decode(bytes));
}

export function logEntryToCbor(e: LogEntry): CborMap {
  return { seq: e.seq, prev: e.prev, env: envelopeToCbor(e.env), at: e.at };
}

export function logEntryFromCbor(v: CborValue): LogEntry {
  const m = asMap(v, ["seq", "prev", "env", "at"]);
  return { seq: asUint(m.seq), prev: asBytes(m.prev, 32), env: envelopeFromCbor(m.env!), at: asUint(m.at) };
}

/**
 * entry_hash = SHA-256("vv/log-entry/v1" || cbor({seq, prev, env, at})).
 * `at` is covered because it drives the retention clock (§12.2): a node
 * must not be able to show different devices different times.
 */
export function entryHash(e: LogEntry): Uint8Array {
  return hashCtx(CTX.logEntry, encode(logEntryToCbor(e)));
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

export interface SealOpInput {
  cid: Uint8Array;
  opId: Uint8Array;
  epoch: EpochKeys;
  author: SigningKeyPair;
  base: number;
  ts: number;
  type: string;
  body: CborValue;
  /** Control-plane ops: header args and the key that signs them (admin MSK, or CRK). */
  control?: ControlArgs & { signer: SigningKeyPair };
  rng?: Rng;
}

function controlSigned(cid: Uint8Array, opId: Uint8Array, epoch: number, c: ControlArgs): CborValue {
  return { cid, op_id: opId, epoch, kind: c.kind, args: argsToCbor(c) };
}

function signedOpBody(env: { cid: Uint8Array; op_id: Uint8Array; epoch: number }, op: OpenedOp): CborMap {
  return {
    op_id: env.op_id,
    cid: env.cid,
    epoch: env.epoch,
    author: op.author,
    base: op.base,
    ts: op.ts,
    type: op.type,
    body: op.body,
  };
}

export function sealOp(input: SealOpInput): OpEnvelope {
  const rng = input.rng ?? defaultRng;
  if (input.opId.length !== 16) throw new Error("op_id must be 16 bytes");
  const epoch = input.epoch.epoch;
  const ids = { cid: input.cid, op_id: input.opId, epoch };

  const unsigned = signedOpBody(ids, {
    author: input.author.pk,
    base: input.base,
    ts: input.ts,
    type: input.type,
    body: input.body,
  });
  const plaintext = encode({ ...unsigned, sig: sign(input.author.sk, CTX.opSig, unsigned) });

  let ctrl: ControlHeader | undefined;
  if (input.control) {
    const { signer, ...args } = input.control;
    const csig = sign(signer.sk, CTX.ctrlSig, controlSigned(input.cid, input.opId, epoch, args));
    ctrl = { ...args, signer: signer.pk, csig } as ControlHeader;
  }

  const header = { v: 1 as const, ...ids, plane: ctrl ? ("c" as const) : ("d" as const), ...(ctrl ? { ctrl } : {}) };
  const aad = encode(headerToCbor(header));
  const nonce = rng(XNONCE_BYTES);
  const ct = aeadSeal(input.epoch.opKey, nonce, plaintext, aad);
  const asig = sign(input.epoch.access.sk, CTX.opAccess, { ...headerToCbor(header), nonce, ct });
  const env: OpEnvelope = { ...header, nonce, ct, asig };
  if (encodeEnvelope(env).length > MAX_OP_BYTES) throw new Error("operation too large");
  return env;
}

// ---------------------------------------------------------------------------
// Verification (node and devices) and opening (devices)
// ---------------------------------------------------------------------------

/** Node check §4.1 (2): some current member, holding EAK_epoch, wrote this. */
export function verifyAccess(env: OpEnvelope, eak: Uint8Array): boolean {
  const { asig, ...rest } = env;
  return verify(eak, CTX.opAccess, { ...headerToCbor(rest), nonce: rest.nonce, ct: rest.ct }, asig);
}

/** Node check §5: the control header is signed by its claimed signer. Membership of the admin set is checked by the caller. */
export function verifyControl(env: OpEnvelope): boolean {
  if (!env.ctrl) return false;
  const { signer, csig, ...args } = env.ctrl;
  return verify(signer, CTX.ctrlSig, controlSigned(env.cid, env.op_id, env.epoch, args as ControlArgs), csig);
}

/** Decrypts and verifies the inner SignedOp (§8.2 steps 4–5). */
export function openOp(env: OpEnvelope, keys: EpochKeys | undefined): OpenResult {
  if (!keys || keys.epoch !== env.epoch) return { ok: false, problem: "no_key" };
  const aad = encode(headerToCbor(env));
  const pt = aeadOpen(keys.opKey, env.nonce, env.ct, aad);
  if (!pt) return { ok: false, problem: "undecryptable" };

  let op: OpenedOp;
  let sig: Uint8Array;
  let m: CborMap;
  try {
    m = asMap(decode(pt), ["op_id", "cid", "epoch", "author", "base", "ts", "type", "body", "sig"]);
    op = {
      author: asBytes(m.author, 32),
      base: asUint(m.base),
      ts: asUint(m.ts),
      type: asText(m.type, 64),
      body: m.body ?? fail(),
    };
    sig = asBytes(m.sig, 64);
    if (
      !equalBytes(asBytes(m.op_id, 16), env.op_id) ||
      !equalBytes(asBytes(m.cid, 32), env.cid) ||
      asUint(m.epoch, U32_MAX) !== env.epoch
    ) {
      return { ok: false, problem: "binding_mismatch" };
    }
  } catch {
    return { ok: false, problem: "malformed" };
  }
  if (!verify(op.author, CTX.opSig, signedOpBody(env, op), sig)) return { ok: false, problem: "bad_signature" };
  return { ok: true, op };
}

// ---------------------------------------------------------------------------
// Device-side log verification → domain entries
// ---------------------------------------------------------------------------

export class IntegrityError extends Error {}

function controlToDomain(c: ControlHeader): DomainControl {
  const signer = toHex(c.signer);
  switch (c.kind) {
    case "genesis":
      return {
        kind: "genesis",
        signer,
        args: { suite: "VV1", crk: toHex(c.args.crk), admins: c.args.admins.map(toHex), eak: toHex(c.args.eak), ik: toHex(c.args.ik) },
      };
    case "rotate":
      return { kind: "rotate", signer, args: { new_epoch: c.args.new_epoch, eak: toHex(c.args.eak) } };
    case "admin.set": {
      const args: { admins: string[]; ik?: string } = { admins: c.args.admins.map(toHex) };
      if (c.args.ik) args.ik = toHex(c.args.ik);
      return { kind: "admin.set", signer, args };
    }
    case "migrate":
      return { kind: "migrate", signer, args: { nodes: [...c.args.nodes] } };
  }
}

export interface VerifierCheckpoint {
  seq: number;
  head: Uint8Array;
  /** EAK public keys this device can check `asig` against, by epoch. */
  eaks: Map<number, Uint8Array>;
}

/**
 * Device-side §8.2 steps 1–5: hash chain, `asig`, control signatures, then
 * decryption and inner signature. Produces domain `Entry` values. Integrity
 * failures (broken chain, bad `asig`/`csig`) mean the node misbehaved and
 * throw; per-op problems (no key, bad inner signature) yield `op: null`.
 */
export class LogVerifier {
  seq: number;
  head: Uint8Array;
  readonly eaks: Map<number, Uint8Array>;

  constructor(
    readonly cid: Uint8Array,
    readonly keyring: Keyring,
    from: VerifierCheckpoint = { seq: 0, head: GENESIS_PREV, eaks: new Map() },
  ) {
    this.seq = from.seq;
    this.head = from.head;
    this.eaks = new Map(from.eaks);
  }

  private eakFor(epoch: number): Uint8Array | undefined {
    return this.eaks.get(epoch) ?? this.keyring.get(epoch)?.access.pk;
  }

  ingest(e: LogEntry): Entry {
    if (e.seq !== this.seq + 1) throw new IntegrityError(`expected seq ${this.seq + 1}, got ${e.seq}`);
    if (!equalBytes(e.prev, this.head)) throw new IntegrityError(`hash chain broken at seq ${e.seq}`);
    const env = e.env;
    if (!equalBytes(env.cid, this.cid)) throw new IntegrityError("entry for another community");

    if (env.ctrl?.kind === "genesis") {
      if (e.seq !== 1) throw new IntegrityError("genesis after seq 1");
      if (!equalBytes(hashCtx(CTX.communityId, env.ctrl.args.crk), this.cid)) {
        throw new IntegrityError("genesis CRK does not match community_id");
      }
      this.eaks.set(0, env.ctrl.args.eak);
    }

    const eak = this.eakFor(env.epoch);
    const opened = openOp(env, this.keyring.get(env.epoch));
    if (eak) {
      if (!verifyAccess(env, eak)) throw new IntegrityError(`bad asig at seq ${e.seq}`);
    } else if (opened.ok) {
      // We can read it but cannot authenticate the envelope: refuse rather
      // than trust content the node may have fabricated.
      throw new IntegrityError(`no EAK for epoch ${env.epoch} at seq ${e.seq}`);
    }
    if (env.ctrl) {
      if (!verifyControl(env)) throw new IntegrityError(`bad control signature at seq ${e.seq}`);
      if (env.ctrl.kind === "rotate") this.eaks.set(env.ctrl.args.new_epoch, env.ctrl.args.eak);
    }

    this.seq = e.seq;
    this.head = entryHash(e);

    const entry: Entry = {
      seq: e.seq,
      opId: toHex(env.op_id),
      epoch: env.epoch,
      at: e.at,
      op: opened.ok ? toDomainOp(opened.op) : null,
    };
    if (env.ctrl) entry.control = controlToDomain(env.ctrl);
    return entry;
  }

  checkpoint(): VerifierCheckpoint {
    return { seq: this.seq, head: this.head, eaks: new Map(this.eaks) };
  }
}

/** Every SignedOp field is required: verifying over a defaulted field would let implementations disagree. */
function fail(): never {
  throw new WireError("missing field");
}

function toDomainOp(op: OpenedOp): DecodedOp {
  return { author: toHex(op.author), base: op.base, ts: op.ts, type: op.type, body: op.body };
}
