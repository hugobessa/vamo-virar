// Cross-language test vectors (protocol.md §18). Generated deterministically
// from a seeded RNG; tests/vectors/vv1.json is checked in and consumed by
// crates/vv-crypto. This test fails if the file drifts from the code.
//
// Regenerate after an intentional change:  VV_WRITE_VECTORS=1 npm run vectors

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encode, fromHex, toHex, utf8, type CborValue } from "@vamo-virar/protocol";
import { describe, expect, it } from "vitest";
import { encodeEnvelope, entryHash, GENESIS_PREV, logEntryToCbor, openOp, sealOp, verifyAccess, verifyControl, type OpEnvelope } from "../src/envelope.js";
import { hpkeSeal } from "../src/hpke.js";
import { encodeKeyEnvelope, sealKeyEnvelope } from "../src/keyenv.js";
import { communityId, deriveEpochKeys, generateMemberKeys, mailboxId, memberId } from "../src/keys.js";
import { aeadSeal, CTX, frame, generateEncryptionKeyPair, sign, signingKeyPair } from "../src/primitives.js";
import { seededRng } from "./helpers.js";

const VECTORS_PATH = fileURLToPath(new URL("../../../tests/vectors/vv1.json", import.meta.url));

/** JSON form of CBOR values: byte strings as {"$b": hex}. */
function toJson(v: CborValue): unknown {
  if (v instanceof Uint8Array) return { $b: toHex(v) };
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toJson(x!)]));
  }
  return v;
}

function generate(): unknown {
  const rng = seededRng("vv1-vectors");
  const h = toHex;

  const cborValues: CborValue[] = [
    0, 23, 24, 255, 256, 65535, 65536, 4294967295, 4294967296, Number.MAX_SAFE_INTEGER,
    -1, -24, -25, -Number.MAX_SAFE_INTEGER,
    "", "vv", "Praça do Derby 🎉", rng(0), rng(1), rng(33),
    true, false, null, [], [1, [2, "x"]],
    { b: 1, a: 2, aa: 3, "": 0 }, { nested: { z: [rng(2)], y: null } },
  ];
  const cbor = cborValues.map((v) => ({ json: toJson(v), hex: h(encode(v)) }));
  const cborInvalid = [
    "1817", "190017", "5f4101ff", "9fff", "f93c00", "f7", "c06161", "a2616201616101", "a2616101616102",
    "a20101616101", "0000", "62c328", "62c080", "63eda080", "1a0000", "1b0020000000000000",
  ];

  const crk = signingKeyPair(rng(32));
  const cid = communityId(crk.pk);
  const member = generateMemberKeys(rng);
  const ids = {
    crk: h(crk.pk),
    community_id: h(cid),
    msk: h(member.signing.pk),
    member_id: h(memberId(member.signing.pk)),
    mailbox_id: h(mailboxId(cid, member.signing.pk)),
  };

  const epochKeys = [0, 1, 4294967295].map((epoch) => {
    const key = rng(32);
    const k = deriveEpochKeys(cid, epoch, key);
    return { cid: h(cid), epoch, key: h(key), op_key: h(k.opKey), snapshot_key: h(k.snapshotKey), eak_seed: h(k.access.sk), eak_pk: h(k.access.pk) };
  });

  const signatures = [
    { ctx: CTX.opSig, msg: { a: 1 } as CborValue },
    { ctx: CTX.auth, msg: { community_id: cid, node_id: rng(32), nonce: rng(32), scope: "community" } },
    { ctx: "vv/test/v1", msg: [utf8("x"), 1, null] },
  ].map(({ ctx, msg }) => {
    const kp = signingKeyPair(rng(32));
    return { ctx, msg_cbor: h(encode(msg)), framed: h(frame(ctx, msg)), seed: h(kp.sk), pk: h(kp.pk), sig: h(sign(kp.sk, ctx, msg)) };
  });

  const s0 = signatures[0]!;
  const sigBytes = fromHex(s0.sig);
  const L = fromHex("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010");
  const sPlusL = (() => {
    const out = new Uint8Array(32);
    let carry = 0;
    for (let i = 0; i < 32; i++) {
      const v = sigBytes[32 + i]! + L[i]! + carry;
      out[i] = v & 0xff;
      carry = v >> 8;
    }
    return out;
  })();
  const identity = "01" + "00".repeat(31);
  const signaturesInvalid = [
    { why: "wrong context", ctx: CTX.ctrlSig, msg_cbor: s0.msg_cbor, pk: s0.pk, sig: s0.sig },
    { why: "flipped bit", ctx: s0.ctx, msg_cbor: s0.msg_cbor, pk: s0.pk, sig: h(sigBytes.map((b, i) => (i === 40 ? b ^ 1 : b))) },
    { why: "non-canonical s (s + L)", ctx: s0.ctx, msg_cbor: s0.msg_cbor, pk: s0.pk, sig: s0.sig.slice(0, 64) + h(sPlusL) },
    { why: "small-order public key", ctx: s0.ctx, msg_cbor: s0.msg_cbor, pk: identity, sig: identity + "00".repeat(32) },
  ];

  const aead = [0, 1, 100].map((n) => {
    const key = rng(32);
    const nonce = rng(24);
    const aad = rng(n % 17);
    const pt = rng(n);
    return { key: h(key), nonce: h(nonce), aad: h(aad), pt: h(pt), ct: h(aeadSeal(key, nonce, pt, aad)) };
  });

  const hpke = [0, 32, 77].map((n) => {
    const r = generateEncryptionKeyPair(rng);
    const info = rng(n % 13);
    const aad = rng(n % 7);
    const pt = rng(n);
    const s = hpkeSeal(r.pk, info, aad, pt, { ikmE: rng(32) });
    return { sk_r: h(r.sk), pk_r: h(r.pk), info: h(info), aad: h(aad), pt: h(pt), enc: h(s.enc), ct: h(s.ct) };
  });

  const k0 = deriveEpochKeys(cid, 0, fromHex(epochKeys[0]!.key));
  const recipient = generateEncryptionKeyPair(rng);
  const keyEnvelopes = [
    { recipient_sk: h(recipient.sk), envelope_cbor: h(encodeKeyEnvelope(sealKeyEnvelope(cid, 0, k0.key, recipient.pk, { ikmE: rng(32) }))), key: h(k0.key) },
  ];

  const admin = signingKeyPair(rng(32));
  const base = { cid, epoch: k0, author: member.signing, base: 3, ts: 1_759_276_800_000, rng };
  const dataOp = sealOp({ ...base, opId: rng(16), type: "event.create", body: { event_id: h(rng(16)), title: "Ato", capacity: 20 } });
  const rotateOp = sealOp({
    ...base,
    author: admin,
    opId: rng(16),
    type: "epoch.rotate",
    body: { reason: "member removed", removed: [] },
    control: { kind: "rotate", signer: admin, args: { new_epoch: 1, eak: rng(32) } },
  });
  const impersonated = sealOp({ ...base, author: { sk: admin.sk, pk: member.signing.pk }, opId: rng(16), type: "member.leave", body: {} });
  const tampered: OpEnvelope = { ...dataOp, ct: dataOp.ct.map((b, i) => (i === 0 ? b ^ 1 : b)) };
  // A validly signed SignedOp with no `body` field: both sides must call it malformed.
  const noBody = (() => {
    const opId = rng(16);
    const unsigned = { op_id: opId, cid, epoch: 0, author: member.signing.pk, base: 0, ts: 0, type: "member.leave" };
    const pt = encode({ ...unsigned, sig: sign(member.signing.sk, CTX.opSig, unsigned) });
    const header = { v: 1, cid, op_id: opId, epoch: 0, plane: "d" };
    const nonce = rng(24);
    const ct = aeadSeal(k0.opKey, nonce, pt, encode(header));
    const asig = sign(k0.access.sk, CTX.opAccess, { ...header, nonce, ct });
    return { v: 1, cid, op_id: opId, epoch: 0, plane: "d", nonce, ct, asig } as OpEnvelope;
  })();
  const opVectors = [
    ["data op", dataOp],
    ["control rotate", rotateOp],
    ["impersonated author", impersonated],
    ["tampered ciphertext", tampered],
    ["signed op without body", noBody],
  ].map(([why, env]) => {
    const e = env as OpEnvelope;
    const opened = openOp(e, k0);
    return {
      why,
      epoch_key: h(k0.key),
      cid: h(cid),
      envelope_cbor: h(encodeEnvelope(e)),
      access_valid: verifyAccess(e, k0.access.pk),
      control_valid: e.ctrl ? verifyControl(e) : null,
      opened: opened.ok
        ? { author: h(opened.op.author), base: opened.op.base, ts: opened.op.ts, type: opened.op.type, body_cbor: h(encode(opened.op.body)) }
        : { problem: opened.problem },
    };
  });

  const e1 = { seq: 1, prev: GENESIS_PREV, env: dataOp, at: 1_759_276_860_000 };
  const e2 = { seq: 2, prev: entryHash(e1), env: rotateOp, at: 1_759_276_920_000 };
  const logEntries = [e1, e2].map((e) => ({ entry_cbor: h(encode(logEntryToCbor(e))), entry_hash: h(entryHash(e)) }));

  return {
    suite: "VV1",
    note: "Generated by packages/crypto/test/vectors.test.ts. Do not edit by hand.",
    cbor,
    cbor_invalid: cborInvalid,
    ids,
    epoch_keys: epochKeys,
    signatures,
    signatures_invalid: signaturesInvalid,
    aead,
    hpke,
    key_envelopes: keyEnvelopes,
    op_envelopes: opVectors,
    log_entries: logEntries,
  };
}

describe("test vectors", () => {
  it("tests/vectors/vv1.json matches the implementation", () => {
    const fresh = `${JSON.stringify(generate(), null, 2)}\n`;
    if (process.env.VV_WRITE_VECTORS === "1") writeFileSync(VECTORS_PATH, fresh);
    expect(readFileSync(VECTORS_PATH, "utf8")).toBe(fresh);
  });
});
