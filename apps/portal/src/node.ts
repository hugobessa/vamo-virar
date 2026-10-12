// Client for the node's operator API (docs/managed-hosting.md). It runs on a
// private listener; the portal is the only thing that talks to it.

import type { Limits } from "./config.js";

export interface NodeOperator {
  /** Makes the tenant, or gives an existing one a fresh code. Returns the code. */
  issueToken(tenant: string, limits: Limits): Promise<string>;
  /** The tenant's code stops creating communities; its communities keep working. */
  revoke(tenant: string): Promise<void>;
}

export class NodeError extends Error {}

export function nodeOperator(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): NodeOperator {
  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      // fetch() only says "fetch failed"; the reason (ENOTFOUND, ECONNREFUSED,
      // a timeout) is in `cause`, and it is what tells a wrong address from a
      // node that is not listening.
      const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
      const why = cause?.code ?? cause?.message ?? (e as Error).message;
      throw new NodeError(`não consegui falar com o nó em ${baseUrl}: ${why}`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  }

  const fail = (what: string, r: { status: number; json: Record<string, unknown> }) =>
    new NodeError(`${what}: o nó respondeu ${r.status} ${String(r.json.code ?? "")} ${String(r.json.detail ?? "")}`.trim());

  return {
    async issueToken(tenant, limits) {
      const made = await call("POST", "/operator/v1/tenants", {
        name: tenant,
        max_communities: limits.maxCommunities,
        max_log_bytes: limits.maxLogBytes,
        max_blob_bytes_total: limits.maxBlobBytes,
      });
      if (made.status === 201 && typeof made.json.token === "string") return made.json.token;
      if (made.status !== 409) throw fail("criar o acesso", made);
      // Already there (an earlier attempt, or a revoked tenant): new code.
      const fresh = await call("POST", `/operator/v1/tenants/${encodeURIComponent(tenant)}/token`);
      if (fresh.status === 200 && typeof fresh.json.token === "string") return fresh.json.token;
      throw fail("gerar um código novo", fresh);
    },
    async revoke(tenant) {
      const r = await call("DELETE", `/operator/v1/tenants/${encodeURIComponent(tenant)}`);
      if (r.status !== 200 && r.status !== 404) throw fail("revogar o acesso", r);
    },
  };
}
