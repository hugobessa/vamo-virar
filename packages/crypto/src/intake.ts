// Join requests (§10.1), node authentication (§3.1) and invite codes (§10.3).

import { concatBytes, decode, encode, equalBytes, utf8, type CborValue } from "@vamo-virar/protocol";
import { hpkeOpen, hpkeSeal, type HpkeSealed, type SealOptions } from "./hpke.js";
import type { MemberKeys } from "./keys.js";
import { CTX, hashCtx, sign, verify, type EncryptionKeyPair, type SigningKeyPair } from "./primitives.js";
import { asBytes, asMap, asText, optional, type CborMap } from "./wire.js";

// ---------------------------------------------------------------------------
// Join requests
// ---------------------------------------------------------------------------

export interface JoinRequest {
  cid: Uint8Array;
  msk: Uint8Array;
  mek: Uint8Array;
  /** Domain profile ({display_name, contact?}); validated by the domain on member.add. */
  profile: CborValue;
  message?: string;
  invite_code?: Uint8Array;
}

const joinInfo = (cid: Uint8Array) => concatBytes(utf8(CTX.join), cid);
const EMPTY = new Uint8Array(0);

function joinFields(r: JoinRequest): CborMap {
  return { cid: r.cid, msk: r.msk, mek: r.mek, profile: r.profile, message: r.message, invite_code: r.invite_code };
}

/**
 * Applicant side. The request is signed by the applicant's fresh MSK (proving
 * possession) and binds the community id, so it cannot be replayed elsewhere.
 */
export function sealJoinRequest(
  ik: Uint8Array,
  applicant: MemberKeys,
  req: Omit<JoinRequest, "msk" | "mek">,
  opts?: SealOptions,
): HpkeSealed {
  const full: JoinRequest = { ...req, msk: applicant.signing.pk, mek: applicant.encryption.pk };
  const fields = joinFields(full);
  const pt = encode({ ...fields, sig: sign(applicant.signing.sk, CTX.joinReq, fields) });
  return hpkeSeal(ik, joinInfo(req.cid), EMPTY, pt, opts);
}

/** Admin side. Null if it does not open, is malformed, unsigned, or for another community. */
export function openJoinRequest(sealed: HpkeSealed, cid: Uint8Array, ik: EncryptionKeyPair): JoinRequest | null {
  const pt = hpkeOpen(ik.sk, sealed.enc, joinInfo(cid), EMPTY, sealed.ct);
  if (!pt) return null;
  try {
    const m = asMap(decode(pt), ["cid", "msk", "mek", "profile", "message", "invite_code", "sig"]);
    const req: JoinRequest = {
      cid: asBytes(m.cid, 32),
      msk: asBytes(m.msk, 32),
      mek: asBytes(m.mek, 32),
      profile: m.profile ?? null,
    };
    const message = optional(m.message, (v) => asText(v, 2000));
    const invite = optional(m.invite_code, (v) => asBytes(v, 32));
    if (message !== undefined) req.message = message;
    if (invite !== undefined) req.invite_code = invite;
    if (!equalBytes(req.cid, cid)) return null;
    if (!verify(req.msk, CTX.joinReq, joinFields(req), asBytes(m.sig, 64))) return null;
    return req;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Node authentication
// ---------------------------------------------------------------------------

/** `moderate`: join requests and snapshots, for admins and moderators (§15). */
export type AuthScope = "community" | "mailbox" | "control" | "moderate";

export interface AuthChallenge {
  community_id: Uint8Array;
  node_id: Uint8Array;
  nonce: Uint8Array;
  scope: AuthScope;
}

const authFields = (c: AuthChallenge): CborMap => ({
  community_id: c.community_id,
  node_id: c.node_id,
  nonce: c.nonce,
  scope: c.scope,
});

export function signAuth(key: SigningKeyPair, c: AuthChallenge): Uint8Array {
  return sign(key.sk, CTX.auth, authFields(c));
}

export function verifyAuth(pk: Uint8Array, c: AuthChallenge, sig: Uint8Array): boolean {
  return verify(pk, CTX.auth, authFields(c), sig);
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/** What the node stores for an invite link: SHA-256("vv/invite/v1" || invite_secret). */
export function inviteHash(secret: Uint8Array): Uint8Array {
  return hashCtx(CTX.invite, secret);
}
