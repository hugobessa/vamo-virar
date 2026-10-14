// The operator client against a real community-node binary (VV_NODE_BIN, or
// target/debug/community-node; `cargo build -p community-node` first).

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nodeOperator, NodeError } from "../src/node.js";

const NODE_BIN = process.env.VV_NODE_BIN ?? fileURLToPath(new URL("../../../target/debug/community-node", import.meta.url));
const HAVE_NODE = existsSync(NODE_BIN);
if (!HAVE_NODE && process.env.VV_REQUIRE_NODE) throw new Error(`community-node binary not found at ${NODE_BIN}`);
const OPERATOR = "operator-token-0123456789";

describe.skipIf(!HAVE_NODE)("against a real node", () => {
  let child: ChildProcess;
  let publicUrl: string;
  let operatorUrl: string;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "vv-portal-node-"));
    const config = join(dir, "config.toml");
    writeFileSync(config, `operator_listen = "127.0.0.1:0"\noperator_token = "${OPERATOR}"\n`);
    child = spawn(NODE_BIN, ["--config", config, "--listen", "127.0.0.1:0", "--data-dir", dir], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error(`node did not start: ${out}`)), 10_000);
      child.stdout!.on("data", (d: Buffer) => {
        out += d.toString();
        const op = /operator API listening on (\S+)/.exec(out);
        const pub = /community-node listening on (\S+)/.exec(out);
        if (op && pub) {
          clearTimeout(timer);
          operatorUrl = `http://${op[1]}`;
          publicUrl = `http://${pub[1]}`;
          resolve();
        }
      });
      child.stderr!.on("data", (d: Buffer) => (out += d.toString()));
      child.on("exit", (code) => reject(new Error(`node exited (${code}): ${out}`)));
    });
  });

  afterAll(() => {
    child?.kill("SIGINT");
  });

  /** 403 means the node refused the code; anything else got past that check. */
  async function provisionStatus(token: string): Promise<number> {
    const res = await fetch(`${publicUrl}/v1/communities`, {
      method: "POST",
      headers: { "x-vv-provision-token": token, "content-type": "application/cbor" },
      body: new Uint8Array([0xa0]),
    });
    return res.status;
  }

  async function tenants(): Promise<Array<Record<string, unknown>>> {
    const res = await fetch(`${operatorUrl}/operator/v1/tenants`, { headers: { authorization: `Bearer ${OPERATOR}` } });
    return ((await res.json()) as { tenants: Array<Record<string, unknown>> }).tenants;
  }

  it("issues, replaces and revokes codes", async () => {
    const node = nodeOperator(operatorUrl, OPERATOR);
    const limits = { maxCommunities: 2, maxLogBytes: 64 * 1024 * 1024, maxBlobBytes: 128 * 1024 * 1024 };
    const first = await node.issueToken("pedido-1", limits);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await provisionStatus(first)).not.toBe(403);
    expect(await provisionStatus("not-a-code")).toBe(403);

    const [t] = await tenants();
    expect(t).toMatchObject({ name: "pedido-1", source: "operator", max_communities: 2, max_log_bytes_per_community: limits.maxLogBytes, max_blob_bytes_total_per_community: limits.maxBlobBytes });

    // Issuing again for the same tenant replaces the code.
    let second = await node.issueToken("pedido-1", limits);
    expect(second).not.toBe(first);
    expect(await provisionStatus(first)).toBe(403);
    expect(await provisionStatus(second)).not.toBe(403);

    // Limits change in place; issuing again applies the given limits too.
    await node.setLimits("pedido-1", { ...limits, maxCommunities: null });
    expect((await tenants())[0]).toMatchObject({ max_communities: null });
    await node.issueToken("pedido-1", { ...limits, maxCommunities: 5 });
    expect((await tenants())[0]).toMatchObject({ max_communities: 5 });
    await expect(node.setLimits("nobody", limits)).rejects.toThrow(NodeError);
    second = await node.issueToken("pedido-1", limits);

    await node.revoke("pedido-1");
    expect(await provisionStatus(second)).toBe(403);
    expect((await tenants())[0]!.revoked_at).toEqual(expect.any(Number));
    await node.revoke("nobody");
  });

  it("reports a wrong operator token", async () => {
    await expect(nodeOperator(operatorUrl, "wrong-token-0123456789").issueToken("x", { maxCommunities: 1, maxLogBytes: 1, maxBlobBytes: 1 })).rejects.toThrow(NodeError);
  });
});

describe("unreachable node", () => {
  it("says why the connection failed", async () => {
    // A port that was free a moment ago: nothing listens there.
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((r) => probe.close(r));
    await expect(
      nodeOperator(`http://127.0.0.1:${port}`, "token-0123456789abcdef").issueToken("x", { maxCommunities: 1, maxLogBytes: 1, maxBlobBytes: 1 }),
    ).rejects.toThrow(/não consegui falar com o nó em http:\/\/127\.0\.0\.1:\d+: ECONNREFUSED/);
  });
});
