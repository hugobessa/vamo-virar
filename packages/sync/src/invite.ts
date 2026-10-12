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

/** Where invite links point: the web app, which also takes them in a browser. */
export const INVITE_BASE = "https://web.vamovirar.app/join";

/**
 * `https://web.vamovirar.app/join#c=…&n=…&k=…&i=…` (§10.3). The invite sits in
 * the fragment, which browsers never send to the server hosting the page.
 */
export function inviteLink(inv: Invite, base = INVITE_BASE): string {
  const q = [`c=${toHex(inv.cid)}`, `n=${encodeURIComponent(inv.node)}`, `k=${toHex(inv.ik)}`];
  if (inv.secret) q.push(`i=${toHex(inv.secret)}`);
  return `${base}#${q.join("&")}`;
}

/** The invite part of a link: after `#` in https links, after `?` in `vamovirar://join` ones. */
function inviteQuery(link: string): string {
  if (link.startsWith(`${SCHEME}?`)) return link.slice(SCHEME.length + 1);
  const m = /^https:\/\/[^/?#\s]+\/join\/?[?#](.*)$/.exec(link);
  if (m) return m[1]!;
  throw new Error("not a vamo-virar invite link");
}

export function parseInvite(link: string): Invite {
  const query = inviteQuery(link);
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
  | { kind: "removed"; reason?: string }
  /** "Could you come to this event?" from an organizer (§10.4). */
  | { kind: "probe"; probe_id: Uint8Array; event_id: string; reply_to: Uint8Array; reply_mbx: Uint8Array; expires: number }
  /** A member's answer, signed by their MSK so the organizer knows who answered. */
  | { kind: "probe_reply"; probe_id: Uint8Array; member_id: string; answer: ProbeAnswer; sig: Uint8Array }
  /**
   * A member reporting another member to the admins. One copy is sealed to
   * each admin's MEK, so neither the node nor the reported person can read
   * it; signed by the reporter's MSK so admins know who sent it.
   */
  | {
      kind: "report";
      report_id: Uint8Array;
      reporter: string;
      member_id: string;
      reason: ReportReason;
      details?: string;
      sig: Uint8Array;
    };

export type ProbeAnswer = "eligible" | "maybe" | "not_eligible";
const ANSWERS: ProbeAnswer[] = ["eligible", "maybe", "not_eligible"];

export type ReportReason = "harassment" | "spam" | "impersonation" | "unsafe" | "other";
export const REPORT_REASONS: readonly ReportReason[] = ["harassment", "spam", "impersonation", "unsafe", "other"];
export const REPORT_DETAILS_MAX = 1000;

const isBytes = (v: unknown, n: number): v is Uint8Array => v instanceof Uint8Array && v.length === n;

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
    if (kind === "probe") {
      if (!isBytes(body.probe_id, 16) || typeof body.event_id !== "string" || !isBytes(body.reply_to, 32) || !isBytes(body.reply_mbx, 32) || typeof body.expires !== "number") return null;
      return { kind, probe_id: body.probe_id, event_id: body.event_id, reply_to: body.reply_to, reply_mbx: body.reply_mbx, expires: body.expires };
    }
    if (kind === "probe_reply") {
      if (!isBytes(body.probe_id, 16) || typeof body.member_id !== "string" || !ANSWERS.includes(body.answer as ProbeAnswer) || !isBytes(body.sig, 64)) return null;
      return { kind, probe_id: body.probe_id, member_id: body.member_id, answer: body.answer as ProbeAnswer, sig: body.sig };
    }
    if (kind === "report") {
      if (
        !isBytes(body.report_id, 16) ||
        typeof body.reporter !== "string" ||
        typeof body.member_id !== "string" ||
        !REPORT_REASONS.includes(body.reason as ReportReason) ||
        (body.details !== undefined && (typeof body.details !== "string" || body.details.length > REPORT_DETAILS_MAX)) ||
        !isBytes(body.sig, 64)
      ) {
        return null;
      }
      const m: MailMessage = { kind, report_id: body.report_id, reporter: body.reporter, member_id: body.member_id, reason: body.reason as ReportReason, sig: body.sig };
      if (typeof body.details === "string") m.details = body.details;
      return m;
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

