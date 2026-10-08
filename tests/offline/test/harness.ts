// Harness for offline scenarios: a real community-node built with the
// `test-clock` feature (so time can jump days), behind a proxy that can go
// down, lose responses, fail at random, or tamper with what it returns.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, type CommunityState } from "@vamo-virar/domain";
import { decode, encode, type CborValue } from "@vamo-virar/protocol";
import { NodeClient } from "@vamo-virar/sync";

const DEFAULT_BIN = fileURLToPath(new URL("../../../target/test-clock/debug/community-node", import.meta.url));
export const NODE_BIN = process.env.VV_NODE_TEST_BIN ?? DEFAULT_BIN;
export const HAVE_NODE = existsSync(NODE_BIN);
if (!HAVE_NODE && process.env.VV_REQUIRE_NODE) throw new Error(`test-clock node binary not found at ${NODE_BIN}`);
export const TOKEN = "offline-token";

export const DAY_S = 86_400;

export class TestNode {
  private child: ChildProcess | null = null;
  url = "";

  constructor(
    readonly dataDir: string,
    private readonly config: Record<string, number | string>,
  ) {}

  static async start(config: Record<string, number | string> = {}): Promise<TestNode> {
    const n = new TestNode(mkdtempSync(join(tmpdir(), "vv-offline-")), config);
    await n.boot();
    return n;
  }

  async boot(): Promise<void> {
    const lines = Object.entries({ provisioning_token: TOKEN, housekeeping_interval_secs: 3600, ...this.config }).map(
      ([k, v]) => `${k} = ${typeof v === "string" ? JSON.stringify(v) : v}`,
    );
    writeFileSync(join(this.dataDir, "c.toml"), `${lines.join("\n")}\n`);
    const child = spawn(NODE_BIN, ["--config", join(this.dataDir, "c.toml"), "--listen", "127.0.0.1:0", "--data-dir", this.dataDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.url = await new Promise<string>((resolve, reject) => {
      let out = "";
      child.stdout!.on("data", (d: Buffer) => {
        out += d.toString();
        const m = /listening on (\S+)/.exec(out);
        if (m) resolve(`http://${m[1]}`);
      });
      child.stderr!.on("data", (d: Buffer) => (out += d.toString()));
      child.on("exit", (c) => reject(new Error(`node exited ${c}: ${out}`)));
    });
  }

  /** Moves the node's clock forward and runs its housekeeping (expiry, compaction). */
  async advance(seconds: number): Promise<void> {
    const res = await fetch(`${this.url}/v1/test/clock`, {
      method: "POST",
      headers: { "content-type": "application/cbor" },
      body: encode({ advance_secs: seconds }) as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`advance failed: ${res.status}`);
  }

  async stop(): Promise<void> {
    const c = this.child;
    if (!c || c.exitCode !== null) return;
    await new Promise<void>((r) => {
      c.once("exit", () => r());
      c.kill("SIGINT");
    });
  }

  /** The node and its disk are gone. */
  async destroy(): Promise<void> {
    await this.stop();
    rmSync(this.dataDir, { recursive: true, force: true });
  }
}

export type Fault =
  | { mode: "up" }
  | { mode: "down" }
  /** Fails before forwarding with probability `before`, or forwards and then drops the response with `after`. */
  | { mode: "flaky"; before: number; after: number; rng: () => number }
  /** Rewrites successful log responses. */
  | { mode: "tamper"; edit: (body: CborValue) => CborValue };

/** An HTTP proxy in front of a node. Clients only ever see the proxy's URL. */
export class FaultProxy {
  fault: Fault = { mode: "up" };
  private server!: Server;
  url = "";
  stats = { forwarded: 0, failedBefore: 0, droppedAfter: 0 };

  constructor(public target: string) {}

  static async start(target: string): Promise<FaultProxy> {
    const p = new FaultProxy(target);
    p.server = createServer(async (req, res) => {
      const f = p.fault;
      if (f.mode === "down" || (f.mode === "flaky" && f.rng() < f.before)) {
        if (f.mode === "flaky") p.stats.failedBefore++;
        req.socket.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try {
        const upstream = await fetch(p.target + req.url, {
          method: req.method!,
          headers: Object.fromEntries(
            Object.entries(req.headers).filter(([k]) => ["authorization", "content-type", "x-vv-provision-token"].includes(k)),
          ) as Record<string, string>,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        p.stats.forwarded++;
        let body: Uint8Array = new Uint8Array(await upstream.arrayBuffer());
        if (f.mode === "flaky" && f.rng() < f.after) {
          p.stats.droppedAfter++;
          req.socket.destroy(); // the node did the work; the client never hears back
          return;
        }
        const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
        if (f.mode === "tamper" && upstream.ok && ct.includes("cbor") && req.url!.includes("/ops?")) {
          body = encode(f.edit(decode(body)));
        }
        res.writeHead(upstream.status, { "content-type": ct });
        res.end(Buffer.from(body));
      } catch {
        res.writeHead(502);
        res.end();
      }
    });
    await new Promise<void>((r) => p.server.listen(0, "127.0.0.1", () => r()));
    const addr = p.server.address();
    p.url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    return p;
  }

  client(): NodeClient {
    return new NodeClient(this.url, { provisioningToken: TOKEN });
  }

  close(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }
}

export function canon(s: CommunityState | null): string {
  if (!s) return "null";
  const { op_ids: _ignored, ...rest } = s;
  return canonicalJson(rest);
}

/** Deterministic PRNG (mulberry32) for reproducible random scenarios. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tries `f` until it succeeds; network failures are expected here. */
export async function retry<T>(f: () => Promise<T>, attempts = 50): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await f();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
