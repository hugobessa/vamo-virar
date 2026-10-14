// Device links (protocol.md §10.5.5): the link format, the bundle of keys it
// unlocks, and the new device's side of the exchange. The source device's
// side lives in `Replica.offerLink`, which needs the community's access key.

import { linkKey, linkRendezvous, normalizeLinkCode, openLinkBundle, LINK_SECRET_BYTES } from "@vamo-virar/crypto";
import { decode, encode, fromHex, toHex, type CborValue } from "@vamo-virar/protocol";
import { NodeClient, NodeError } from "./client.js";
import { deviceSetFromCbor, deviceSetToCbor, type DeviceSet } from "./devices.js";

/** How long a link works. */
export const LINK_TTL_MS = 10 * 60_000;

/** Where links point: the web app, which also takes them in a browser. */
export const LINK_BASE = "https://web.vamovirar.app/link";
const SCHEME = "vamovirar://link";

export interface DeviceLink {
  node: string;
  cid: Uint8Array;
  secret: Uint8Array;
  /** Present in the QR; left out of a copied link, so the person types it. */
  code?: string;
}

export function deviceLinkUrl(l: DeviceLink, base = LINK_BASE): string {
  const q = [`n=${encodeURIComponent(l.node)}`, `c=${toHex(l.cid)}`, `s=${toHex(l.secret)}`];
  if (l.code) q.push(`w=${l.code}`);
  return `${base}#${q.join("&")}`;
}

function linkQuery(link: string): string {
  if (link.startsWith(`${SCHEME}?`)) return link.slice(SCHEME.length + 1);
  const m = /^https:\/\/[^/?#\s]+\/link\/?[?#](.*)$/.exec(link);
  if (m) return m[1]!;
  throw new LinkError("malformed", "not a device link");
}

export function parseDeviceLink(link: string): DeviceLink {
  const params = new Map<string, string>();
  for (const pair of linkQuery(link.trim()).split("&")) {
    const [k, v = ""] = pair.split("=", 2);
    if (k) params.set(k, decodeURIComponent(v));
  }
  const node = params.get("n") ?? "";
  const cidHex = params.get("c") ?? "";
  const secretHex = params.get("s") ?? "";
  if (!/^https?:\/\//.test(node)) throw new LinkError("malformed", "device link has a malformed node address");
  if (!/^[0-9a-f]{64}$/.test(cidHex) || !/^[0-9a-f]{64}$/.test(secretHex)) throw new LinkError("malformed", "device link has malformed keys");
  const out: DeviceLink = { node, cid: fromHex(cidHex), secret: fromHex(secretHex) };
  const w = params.get("w");
  if (w) {
    const code = normalizeLinkCode(w);
    if (!code) throw new LinkError("malformed", "device link has a malformed code");
    out.code = code;
  }
  if (out.secret.length !== LINK_SECRET_BYTES) throw new LinkError("malformed", "device link has malformed keys");
  return out;
}

export function isDeviceLink(text: string): boolean {
  try {
    parseDeviceLink(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

export interface LinkEntry {
  cid: Uint8Array;
  node: string;
  /** Private seeds of the member keys. */
  msk: Uint8Array;
  mek: Uint8Array;
  epochs: { epoch: number; key: Uint8Array }[];
  /** Admins: the intake key's private half. */
  ik?: Uint8Array;
  devices?: DeviceSet;
}

export interface LinkBundle {
  v: 1;
  expires: number;
  communities: LinkEntry[];
}

export function encodeLinkBundle(b: LinkBundle): Uint8Array {
  return encode({
    v: 1,
    expires: b.expires,
    communities: b.communities.map((c) => ({
      cid: c.cid,
      node: c.node,
      msk: c.msk,
      mek: c.mek,
      epochs: c.epochs.map((e) => ({ epoch: e.epoch, key: e.key })),
      ik: c.ik,
      devices: c.devices ? deviceSetToCbor(c.devices) : undefined,
    })),
  } as CborValue);
}

const isBytes = (v: unknown, n: number): v is Uint8Array => v instanceof Uint8Array && v.length === n;

export function decodeLinkBundle(bytes: Uint8Array): LinkBundle {
  const bad = () => new LinkError("malformed", "the link bundle is malformed");
  let v: Record<string, unknown>;
  try {
    v = decode(bytes) as Record<string, unknown>;
  } catch {
    throw bad();
  }
  if (!v || v.v !== 1 || typeof v.expires !== "number" || !Array.isArray(v.communities)) throw bad();
  const communities: LinkEntry[] = [];
  for (const raw of v.communities as Record<string, unknown>[]) {
    if (!raw || !isBytes(raw.cid, 32) || typeof raw.node !== "string" || !isBytes(raw.msk, 32) || !isBytes(raw.mek, 32) || !Array.isArray(raw.epochs)) throw bad();
    const epochs = (raw.epochs as Record<string, unknown>[]).map((e) => {
      if (!e || !Number.isInteger(e.epoch) || !isBytes(e.key, 32)) throw bad();
      return { epoch: e.epoch as number, key: e.key };
    });
    if (epochs.length === 0) throw bad();
    const entry: LinkEntry = { cid: raw.cid, node: raw.node, msk: raw.msk, mek: raw.mek, epochs };
    if (raw.ik !== undefined) {
      if (!isBytes(raw.ik, 32)) throw bad();
      entry.ik = raw.ik;
    }
    if (raw.devices !== undefined) {
      const set = deviceSetFromCbor(raw.devices);
      if (!set) throw bad();
      entry.devices = set;
    }
    communities.push(entry);
  }
  return { v: 1, expires: v.expires, communities };
}

export type LinkErrorCode = "malformed" | "expired" | "wrong_code";

export class LinkError extends Error {
  constructor(
    readonly code: LinkErrorCode,
    detail: string,
  ) {
    super(detail);
  }
}

/**
 * The new device's side (§10.5.5): fetch the sealed bundle, open it with the
 * code, and take it off the node. A wrong code leaves it there so the person
 * can type again; a missing one means the link expired or someone used it.
 */
export async function receiveDeviceLink(link: DeviceLink, code: string, client: NodeClient = new NodeClient(link.node)): Promise<LinkBundle> {
  if (!normalizeLinkCode(code)) throw new LinkError("wrong_code", "not a link code");
  const { key: rk, mailbox } = linkRendezvous(link.cid, link.secret);
  let items;
  try {
    items = await client.mailbox(link.cid, rk, mailbox);
  } catch (e) {
    if (e instanceof NodeError && (e.status === 404 || e.code === "not_hosted")) throw new LinkError("expired", "the link expired or was already used");
    throw e;
  }
  const item = items.find((i) => i.kind === "link");
  if (!item) throw new LinkError("expired", "the link expired or was already used");
  const plain = openLinkBundle(await linkKey(link.cid, link.secret, code), link.cid, item.ct);
  if (!plain) throw new LinkError("wrong_code", "the code does not match this link");
  const bundle = decodeLinkBundle(plain);
  await client.ackMailbox(link.cid, rk, mailbox, item.id).catch(() => undefined); // it expires anyway
  if (bundle.expires < Date.now()) throw new LinkError("expired", "the link expired");
  return bundle;
}
