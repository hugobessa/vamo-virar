// Starts a real community-node binary for integration tests.
// The binary is taken from VV_NODE_BIN, or target/debug/community-node.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeClient } from "../src/client.js";

const DEFAULT_BIN = fileURLToPath(new URL("../../../target/debug/community-node", import.meta.url));
export const NODE_BIN = process.env.VV_NODE_BIN ?? DEFAULT_BIN;
export const HAVE_NODE = existsSync(NODE_BIN);
// In CI the integration job sets VV_REQUIRE_NODE so a missing binary fails loudly instead of skipping.
if (!HAVE_NODE && process.env.VV_REQUIRE_NODE) throw new Error(`community-node binary not found at ${NODE_BIN}`);
export const TOKEN = "integration-token";

export interface RunningNode {
  url: string;
  client: (opts?: { fetch?: typeof fetch }) => NodeClient;
  stop: () => Promise<void>;
  dataDir: string;
}

/** `extraToml` is appended verbatim, for tables such as `[[tenants]]`. */
export async function startNode(config: Record<string, number | boolean | string> = {}, extraToml = ""): Promise<RunningNode> {
  const dataDir = mkdtempSync(join(tmpdir(), "vv-node-"));
  const lines = Object.entries({ provisioning_token: TOKEN, ...config }).map(
    ([k, v]) => `${k} = ${typeof v === "string" ? JSON.stringify(v) : v}`,
  );
  const configPath = join(dataDir, "config.toml");
  writeFileSync(configPath, `${lines.join("\n")}\n${extraToml}`);
  const child: ChildProcess = spawn(NODE_BIN, ["--config", configPath, "--listen", "127.0.0.1:0", "--data-dir", dataDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`node did not start: ${out}`)), 10_000);
    child.stdout!.on("data", (d: Buffer) => {
      out += d.toString();
      const m = /listening on (\S+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(`http://${m[1]}`);
      }
    });
    child.stderr!.on("data", (d: Buffer) => (out += d.toString()));
    child.on("exit", (code) => reject(new Error(`node exited (${code}): ${out}`)));
  });
  return {
    url,
    dataDir,
    client: (opts = {}) => new NodeClient(url, { provisioningToken: TOKEN, ...opts }),
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGINT");
      }),
  };
}

export async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("condition not met in time");
}
