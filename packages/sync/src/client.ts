// HTTP + WebSocket client for a community node (protocol.md §3.1, §15).
// Uses only `fetch` and `WebSocket`, available in React Native and Node ≥ 22.

import {
  blobIdOf,
  envelopeToCbor,
  logEntryFromCbor,
  logEntryToCbor,
  signAuth,
  snapshotEnvelopeFromCbor,
  snapshotEnvelopeToCbor,
  type AuthScope,
  type HpkeSealed,
  type LogEntry,
  type OpEnvelope,
  type SigningKeyPair,
  type SnapshotEnvelope,
} from "@vamo-virar/crypto";
import { decode, decodeUtf8, encode, toHex, type CborValue } from "@vamo-virar/protocol";

export class NodeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
    readonly extra: Record<string, CborValue | undefined> = {},
  ) {
    super(`${status} ${code}: ${detail}`);
  }
}

/** The admin-signed new location, when a node says the community moved (§11.3). */
export function movedTo(e: unknown): string[] | null {
  if (!(e instanceof NodeError) || e.code !== "moved") return null;
  const nodes = e.extra.nodes;
  return Array.isArray(nodes) ? nodes.filter((n): n is string => typeof n === "string") : [];
}

export interface RestoreInput {
  controlChain: LogEntry[];
  snapshot?: SnapshotEnvelope;
  tail: LogEntry[];
  intakeMode?: IntakeMode;
  /** Hashes of outstanding invite links, so they keep working after a move. */
  invites?: { hash: Uint8Array; expires_at: number; uses_left: number }[];
}

export type IntakeMode = "open" | "invite_only" | "closed";

export type SubmitResult = { op_id: Uint8Array; seq: number } | { op_id?: Uint8Array; error: string };

export interface MailboxItem {
  id: number;
  kind: string;
  ct: Uint8Array;
  posted_at: number;
}

export interface IntakeItem {
  id: number;
  sealed: HpkeSealed;
  at: number;
}

export interface BlobInfo {
  blobId: Uint8Array;
  size: number;
  /** Node receive time (ms). */
  at: number;
}

type Obj = { [k: string]: CborValue | undefined };

interface Session {
  token: string;
  expiresAt: number;
}

export interface NodeClientOptions {
  /** Sent as x-vv-provision-token when creating or restoring a community. */
  provisioningToken?: string;
  fetch?: typeof fetch;
}

export class NodeClient {
  readonly baseUrl: string;
  private readonly sessions = new Map<string, Session>();
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl: string,
    private readonly opts: NodeClientOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((...a) => fetch(...a));
  }

  /** A client for another node, with the same transport (used to follow a move). */
  elsewhere(baseUrl: string, opts: Omit<NodeClientOptions, "fetch"> = {}): NodeClient {
    return new NodeClient(baseUrl, { ...opts, fetch: this.fetchImpl });
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async raw(
    method: string,
    path: string,
    body?: CborValue | Uint8Array,
    headers: Record<string, string> = {},
  ): Promise<CborValue> {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = (body instanceof Uint8Array ? body : encode(body)) as unknown as BodyInit;
      const h = init.headers as Record<string, string>;
      if (!h["content-type"]) h["content-type"] = "application/cbor";
    }
    const res = await this.fetchImpl(this.baseUrl + path, init);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let value: CborValue = null;
    if (bytes.length > 0) {
      const ct = res.headers.get("content-type") ?? "";
      // Blobs come back as they were stored: opaque bytes.
      value = ct.includes("cbor") ? decode(bytes) : ct.includes("octet-stream") ? bytes : textOf(bytes);
    }
    if (!res.ok) {
      const v = (value && typeof value === "object" && !(value instanceof Uint8Array) && !Array.isArray(value) ? value : {}) as Obj;
      const { code, detail, ...extra } = v;
      throw new NodeError(res.status, typeof code === "string" ? code : "http_error", typeof detail === "string" ? detail : String(value), extra);
    }
    return value;
  }

  /** Authenticated call; re-authenticates once if the token was revoked or expired. */
  private async authed(
    method: string,
    path: string,
    cid: Uint8Array,
    scope: AuthScope,
    key: SigningKeyPair,
    body?: CborValue | Uint8Array,
    headers: Record<string, string> = {},
  ): Promise<CborValue> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(cid, scope, key);
      try {
        return await this.raw(method, path, body, { ...headers, authorization: `Bearer ${token}` });
      } catch (e) {
        if (attempt === 0 && e instanceof NodeError && e.status === 401) {
          this.sessions.delete(sessionKey(cid, scope, key));
          continue;
        }
        throw e;
      }
    }
  }

  async token(cid: Uint8Array, scope: AuthScope, key: SigningKeyPair): Promise<string> {
    const k = sessionKey(cid, scope, key);
    const cached = this.sessions.get(k);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    const ch = (await this.raw("POST", "/v1/auth/challenge", { community_id: cid })) as Obj;
    const nonce = ch.nonce as Uint8Array;
    const nodeId = ch.node_id as Uint8Array;
    const sig = signAuth(key, { community_id: cid, node_id: nodeId, nonce, scope });
    const s = (await this.raw("POST", "/v1/auth/session", {
      community_id: cid,
      nonce,
      scope,
      public_key: key.pk,
      sig,
    })) as Obj;
    const session = { token: s.token as string, expiresAt: s.expires_at as number };
    this.sessions.set(k, session);
    return session.token;
  }

  forgetSessions(): void {
    this.sessions.clear();
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  /** `push` says whether this node forwards wake-ups to a push gateway (§14). */
  async wellKnown(): Promise<{ protocol: string; node_id: string; push?: boolean }> {
    const res = await this.fetchImpl(`${this.baseUrl}/.well-known/vamo-virar`);
    if (!res.ok) throw new NodeError(res.status, "http_error", "well-known");
    return (await res.json()) as { protocol: string; node_id: string; push?: boolean };
  }

  private provisionHeaders(): Record<string, string> {
    return this.opts.provisioningToken ? { "x-vv-provision-token": this.opts.provisioningToken } : {};
  }

  async createCommunity(genesis: OpEnvelope): Promise<void> {
    await this.raw("POST", "/v1/communities", { genesis: envelopeToCbor(genesis) }, this.provisionHeaders());
  }

  async restoreCommunity(input: RestoreInput): Promise<number> {
    const body: Obj = {
      control_chain: input.controlChain.map(logEntryToCbor),
      tail: input.tail.map(logEntryToCbor),
      snapshot: input.snapshot ? snapshotEnvelopeToCbor(input.snapshot) : undefined,
      intake_mode: input.intakeMode,
      invites: input.invites,
    };
    const res = (await this.raw("POST", "/v1/communities/restore", body, this.provisionHeaders())) as Obj;
    return res.head_seq as number;
  }

  async submit(cid: Uint8Array, eak: SigningKeyPair, ops: OpEnvelope[]): Promise<{ results: SubmitResult[]; head: number }> {
    const res = (await this.authed("POST", `/v1/c/${toHex(cid)}/ops`, cid, "community", eak, {
      ops: ops.map(envelopeToCbor),
    })) as Obj;
    return { results: (res.results as Obj[]).map((r) => r as unknown as SubmitResult), head: res.head_seq as number };
  }

  /** Returns entries after `after`, or `{gone}` when that prefix was compacted. */
  async entries(
    cid: Uint8Array,
    eak: SigningKeyPair,
    after: number,
    limit = 500,
  ): Promise<{ entries: LogEntry[]; head: number } | { gone: number }> {
    try {
      const res = (await this.authed("GET", `/v1/c/${toHex(cid)}/ops?after=${after}&limit=${limit}`, cid, "community", eak)) as Obj;
      return { entries: (res.entries as CborValue[]).map(logEntryFromCbor), head: res.head_seq as number };
    } catch (e) {
      if (e instanceof NodeError && e.status === 410) return { gone: e.extra.snapshot_seq as number };
      throw e;
    }
  }

  async controlEntries(cid: Uint8Array, eak: SigningKeyPair): Promise<LogEntry[]> {
    const res = (await this.authed("GET", `/v1/c/${toHex(cid)}/control`, cid, "community", eak)) as Obj;
    return (res.entries as CborValue[]).map(logEntryFromCbor);
  }

  async snapshot(cid: Uint8Array, eak: SigningKeyPair): Promise<SnapshotEnvelope | null> {
    try {
      return snapshotEnvelopeFromCbor(await this.authed("GET", `/v1/c/${toHex(cid)}/snapshot`, cid, "community", eak));
    } catch (e) {
      if (e instanceof NodeError && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * `scope` is `control` for admins (works with any node) and `moderate`
   * for moderators; the same holds for `intake` and `ackIntake`.
   */
  async putSnapshot(cid: Uint8Array, admin: SigningKeyPair, s: SnapshotEnvelope, scope: StaffScope = "control"): Promise<void> {
    await this.authed("PUT", `/v1/c/${toHex(cid)}/snapshot`, cid, scope, admin, encode(snapshotEnvelopeToCbor(s)));
  }

  async postMailbox(cid: Uint8Array, eak: SigningKeyPair, mailbox: Uint8Array, kind: string, ct: Uint8Array, ttlS?: number): Promise<number> {
    const res = (await this.authed("POST", `/v1/c/${toHex(cid)}/mailbox/${toHex(mailbox)}`, cid, "community", eak, {
      kind,
      ct,
      ttl_s: ttlS,
    })) as Obj;
    return res.id as number;
  }

  async mailbox(cid: Uint8Array, me: SigningKeyPair, mailbox: Uint8Array, after = 0): Promise<MailboxItem[]> {
    const res = (await this.authed("GET", `/v1/c/${toHex(cid)}/mailbox/${toHex(mailbox)}?after=${after}`, cid, "mailbox", me)) as Obj;
    return res.items as unknown as MailboxItem[];
  }

  async ackMailbox(cid: Uint8Array, me: SigningKeyPair, mailbox: Uint8Array, id: number): Promise<void> {
    await this.authed("DELETE", `/v1/c/${toHex(cid)}/mailbox/${toHex(mailbox)}/${id}`, cid, "mailbox", me);
  }

  // --- push (§14): a device's platform token, kept per mailbox so the node can wake it ---

  /** Registers (or replaces) this device's push token for the mailbox `me` signs for. */
  async putPush(cid: Uint8Array, me: SigningKeyPair, token: string): Promise<void> {
    await this.authed("PUT", `/v1/c/${toHex(cid)}/push`, cid, "mailbox", me, { token });
  }

  async deletePush(cid: Uint8Array, me: SigningKeyPair): Promise<void> {
    await this.authed("DELETE", `/v1/c/${toHex(cid)}/push`, cid, "mailbox", me);
  }

  async submitJoinRequest(cid: Uint8Array, sealed: HpkeSealed, invite?: Uint8Array): Promise<number> {
    const res = (await this.raw("POST", `/v1/c/${toHex(cid)}/intake`, { enc: sealed.enc, ct: sealed.ct, invite })) as Obj;
    return res.id as number;
  }

  async intake(cid: Uint8Array, admin: SigningKeyPair, after = 0, scope: StaffScope = "control"): Promise<IntakeItem[]> {
    const res = (await this.authed("GET", `/v1/c/${toHex(cid)}/intake?after=${after}`, cid, scope, admin)) as Obj;
    return (res.items as Obj[]).map((i) => ({
      id: i.id as number,
      sealed: { enc: i.enc as Uint8Array, ct: i.ct as Uint8Array },
      at: i.at as number,
    }));
  }

  async ackIntake(cid: Uint8Array, admin: SigningKeyPair, id: number, scope: StaffScope = "control"): Promise<void> {
    await this.authed("DELETE", `/v1/c/${toHex(cid)}/intake/${id}`, cid, scope, admin);
  }

  async setIntakeMode(cid: Uint8Array, admin: SigningKeyPair, mode: IntakeMode): Promise<void> {
    await this.authed("PUT", `/v1/c/${toHex(cid)}/intake-policy`, cid, "control", admin, { mode });
  }

  async intakeMode(cid: Uint8Array, admin: SigningKeyPair): Promise<IntakeMode> {
    const res = (await this.authed("GET", `/v1/c/${toHex(cid)}/intake-policy`, cid, "control", admin)) as Obj;
    return res.mode as IntakeMode;
  }

  /** Admin export (§11.3): exactly what `restoreCommunity` takes. */
  async exportCommunity(cid: Uint8Array, admin: SigningKeyPair): Promise<RestoreInput> {
    const res = (await this.authed("GET", `/v1/c/${toHex(cid)}/export`, cid, "control", admin)) as Obj;
    return {
      controlChain: (res.control_chain as CborValue[]).map(logEntryFromCbor),
      tail: (res.tail as CborValue[]).map(logEntryFromCbor),
      ...(res.snapshot ? { snapshot: snapshotEnvelopeFromCbor(res.snapshot) } : {}),
      intakeMode: res.intake_mode as IntakeMode,
      invites: (res.invites as Obj[]).map((i) => ({
        hash: i.hash as Uint8Array,
        expires_at: i.expires_at as number,
        uses_left: i.uses_left as number,
      })),
    };
  }

  // --- blobs (§15): opaque bytes named by their SHA-256, for task attachments ---

  /** Stores `ct` under its hash; uploading the same bytes twice is harmless. */
  async putBlob(cid: Uint8Array, eak: SigningKeyPair, ct: Uint8Array): Promise<{ blobId: Uint8Array; size: number }> {
    const id = blobIdOf(ct);
    const res = (await this.authed("PUT", `/v1/c/${toHex(cid)}/blobs/${toHex(id)}`, cid, "community", eak, ct, {
      "content-type": "application/octet-stream",
    })) as Obj;
    return { blobId: res.blob_id as Uint8Array, size: res.size as number };
  }

  /** The stored bytes, or null when the node no longer has them. */
  async getBlob(cid: Uint8Array, eak: SigningKeyPair, blobId: Uint8Array): Promise<Uint8Array | null> {
    try {
      const v = await this.authed("GET", `/v1/c/${toHex(cid)}/blobs/${toHex(blobId)}`, cid, "community", eak);
      return v instanceof Uint8Array ? v : new Uint8Array(0);
    } catch (e) {
      if (e instanceof NodeError && e.status === 404) return null;
      throw e;
    }
  }

  /** Admins and moderators: everything stored, so orphans can be found and dropped. */
  async listBlobs(cid: Uint8Array, staff: SigningKeyPair, scope: StaffScope = "control"): Promise<{ blobs: BlobInfo[]; totalBytes: number }> {
    const res = (await this.authed("GET", `/v1/c/${toHex(cid)}/blobs`, cid, scope, staff)) as Obj;
    return {
      blobs: (res.blobs as Obj[]).map((b) => ({ blobId: b.blob_id as Uint8Array, size: b.size as number, at: b.at as number })),
      totalBytes: res.total_bytes as number,
    };
  }

  async deleteBlob(cid: Uint8Array, staff: SigningKeyPair, blobId: Uint8Array, scope: StaffScope = "control"): Promise<void> {
    await this.authed("DELETE", `/v1/c/${toHex(cid)}/blobs/${toHex(blobId)}`, cid, scope, staff);
  }

  async registerInvite(cid: Uint8Array, admin: SigningKeyPair, hash: Uint8Array, expiresAt: number, maxUses: number): Promise<void> {
    await this.authed("POST", `/v1/c/${toHex(cid)}/invites`, cid, "control", admin, {
      hash,
      expires_at: expiresAt,
      max_uses: maxUses,
    });
  }

  /**
   * Opens the notification stream. `onNotice` receives `{head_seq}`,
   * `{mailbox}` or `{resync}`; data must still be fetched over HTTP.
   */
  async stream(
    cid: Uint8Array,
    eak: SigningKeyPair,
    me: SigningKeyPair | null,
    onNotice: (n: { head_seq?: number; mailbox?: Uint8Array; resync?: boolean }) => void,
  ): Promise<{ close(): void }> {
    const token = await this.token(cid, "community", eak);
    const mt = me ? await this.token(cid, "mailbox", me) : undefined;
    const url = `${this.baseUrl.replace(/^http/, "ws")}/v1/c/${toHex(cid)}/stream?token=${token}${mt ? `&mailbox_token=${mt}` : ""}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev: MessageEvent) => {
      try {
        onNotice(decode(new Uint8Array(ev.data as ArrayBuffer)) as never);
      } catch {
        // ignore malformed notices; the next sync is authoritative anyway
      }
    };
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new NodeError(0, "stream", "could not open stream"));
    });
    return { close: () => ws.close() };
  }
}

export type StaffScope = Extract<AuthScope, "control" | "moderate">;

function sessionKey(cid: Uint8Array, scope: AuthScope, key: SigningKeyPair): string {
  return `${toHex(cid)}:${scope}:${toHex(key.pk)}`;
}

function textOf(b: Uint8Array): string {
  try {
    return decodeUtf8(b);
  } catch {
    return "<binary>";
  }
}
