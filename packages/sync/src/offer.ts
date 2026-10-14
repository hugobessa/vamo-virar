// The source device's side of linking (protocol.md §10.5.5): one bundle with
// every active membership, sealed and left in a throwaway mailbox on one of
// the communities' nodes for ten minutes.

import {
  defaultRng,
  formatLinkCode,
  generateLinkCode,
  LINK_SECRET_BYTES,
  linkKey,
  linkRendezvous,
  sealLinkBundle,
  type Rng,
} from "@vamo-virar/crypto";
import { deviceLinkUrl, encodeLinkBundle, LINK_BASE, LINK_TTL_MS, type LinkEntry } from "./link.js";
import type { Replica } from "./replica.js";

export interface LinkOffer {
  /** For the QR code: carries the code, since it goes straight from screen to camera. */
  qr: string;
  /** For copying: without the code, which the person types on the new device. */
  copy: string;
  /** The code, grouped for reading (`K7QM-2XRA-9P`). */
  code: string;
  expires: number;
  /** How many memberships the bundle carries. */
  communities: number;
  /** Whether the new device has taken the bundle off the node. */
  taken(): Promise<boolean>;
  /** Removes the bundle if it is still there. */
  cancel(): Promise<void>;
}

export async function offerDeviceLink(
  replicas: Replica[],
  label: string,
  opts: { base?: string; rng?: Rng; now?: number } = {},
): Promise<LinkOffer> {
  const rng = opts.rng ?? defaultRng;
  const active = replicas.filter((r) => r.status === "active" && !r.disabled);
  if (active.length === 0) throw new Error("no community to link");
  const entries: LinkEntry[] = [];
  for (const r of active) entries.push(await r.linkEntry(label));
  const expires = (opts.now ?? Date.now()) + LINK_TTL_MS;
  const plain = encodeLinkBundle({ v: 1, expires, communities: entries });
  const secret = rng(LINK_SECRET_BYTES);
  const code = generateLinkCode(rng);
  let lastError: unknown;
  // Any of the communities can host the rendezvous; the first reachable one does.
  for (const host of active) {
    const { key: rk, mailbox } = linkRendezvous(host.cid, secret);
    try {
      const ct = sealLinkBundle(await linkKey(host.cid, secret, code), host.cid, plain, rng);
      await host.postLinkBundle(mailbox, ct);
    } catch (e) {
      lastError = e;
      continue;
    }
    const link = { node: host.node, cid: host.cid, secret };
    const pending = async () => (await host.client.mailbox(host.cid, rk, mailbox)).filter((i) => i.kind === "link");
    return {
      qr: deviceLinkUrl({ ...link, code }, opts.base ?? LINK_BASE),
      copy: deviceLinkUrl(link, opts.base ?? LINK_BASE),
      code: formatLinkCode(code),
      expires,
      communities: entries.length,
      taken: async () => (await pending()).length === 0,
      cancel: async () => {
        for (const i of await pending()) await host.client.ackMailbox(host.cid, rk, mailbox, i.id);
      },
    };
  }
  throw lastError;
}
