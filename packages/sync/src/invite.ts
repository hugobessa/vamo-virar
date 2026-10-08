// Invite links (protocol.md §10.3) and small sealed mailbox messages.

import {
  hpkeOpen,
  hpkeSeal,
  inviteHash,
  type EncryptionKeyPair,
  type Rng,
} from "@vamo-virar/crypto";
import { concatBytes, decode, encode, fromHex, toHex, utf8, type CborValue } from "@vamo-virar/protocol";

export interface Invite {
  cid: Uint8Array;
  node: string;
  /** The community's intake public key. */
  ik: Uint8Array;
  /** Present for invite-only communities. */
  secret?: Uint8Array;
}

const SCHEME = "vamovirar://join";

export function inviteLink(inv: Invite): string {
  const q = [`c=${toHex(inv.cid)}`, `n=${encodeURIComponent(inv.node)}`, `k=${toHex(inv.ik)}`];
  if (inv.secret) q.push(`i=${toHex(inv.secret)}`);
  return `${SCHEME}?${q.join("&")}`;
}

export function parseInvite(link: string): Invite {
  const [base, query = ""] = link.split("?", 2);
  if (base !== SCHEME) throw new Error("not a vamo-virar invite link");
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    const [k, v = ""] = pair.split("=", 2);
    if (k) params.set(k, decodeURIComponent(v));
  }
  const get = (k: string) => {
    const v = params.get(k);
    if (!v) throw new Error(`invite link is missing ${k}`);
    return v;
  };
  const cid = fromHex(get("c"));
  const ik = fromHex(get("k"));
  if (cid.length !== 32 || ik.length !== 32) throw new Error("invite link has malformed keys");
  const node = get("n");
  if (!/^https?:\/\//.test(node)) throw new Error("invite link has a malformed node address");
  const inv: Invite = { cid, node, ik };
  const secret = params.get("i");
  if (secret) {
    const s = fromHex(secret);
    if (s.length !== 32) throw new Error("invite link has a malformed secret");
    inv.secret = s;
  }
  return inv;
}

export { inviteHash };

// ---------------------------------------------------------------------------
// Sealed mailbox messages addressed to one member's MEK.
// ---------------------------------------------------------------------------

export type MailMessage =
  /** The intake key's private half, for a new admin (§10.1). */
  | { kind: "ik_env"; ik_sk: Uint8Array }
  /** An admin's answer to a join request (§10.2). The key itself arrives as a key_env. */
  | { kind: "join_result"; accepted: boolean; reason?: string }
  /**
   * Tells a removed member they were removed. They cannot read the log any
   * more (their access key stops working at the rotation), so without this
   * they would only see a credential failure.
   */
  | { kind: "removed"; reason?: string };

const info = (cid: Uint8Array, kind: string) => concatBytes(utf8(`vv/mail/${kind}/v1`), cid);

export function sealMail(cid: Uint8Array, recipient: Uint8Array, msg: MailMessage, rng?: Rng): Uint8Array {
  const { kind, ...rest } = msg;
  const sealed = hpkeSeal(recipient, info(cid, kind), new Uint8Array(), encode(rest as CborValue), rng ? { rng } : {});
  return encode({ enc: sealed.enc, ct: sealed.ct });
}

export function openMail(cid: Uint8Array, kind: string, me: EncryptionKeyPair, ct: Uint8Array): MailMessage | null {
  try {
    const outer = decode(ct) as { enc: Uint8Array; ct: Uint8Array };
    const pt = hpkeOpen(me.sk, outer.enc, info(cid, kind), new Uint8Array(), outer.ct);
    if (!pt) return null;
    const body = decode(pt) as Record<string, CborValue>;
    if (kind === "ik_env" && body.ik_sk instanceof Uint8Array && body.ik_sk.length === 32) {
      return { kind, ik_sk: body.ik_sk };
    }
    if (kind === "removed") {
      const m: MailMessage = { kind };
      if (typeof body.reason === "string") m.reason = body.reason;
      return m;
    }
    if (kind === "join_result" && typeof body.accepted === "boolean") {
      const m: MailMessage = { kind, accepted: body.accepted };
      if (typeof body.reason === "string") m.reason = body.reason;
      return m;
    }
    return null;
  } catch {
    return null;
  }
}

