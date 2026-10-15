import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig, railwayVolumeProblem, type Limits, type PortalConfig } from "../src/config.js";
import { Requests } from "../src/db.js";
import type { Mail, Mailer } from "../src/mailer.js";
import type { NodeOperator } from "../src/node.js";
import { createHandler } from "../src/server.js";

const PASSWORD = "uma-senha-bem-longa";

class FakeNode implements NodeOperator {
  tenants = new Map<string, { token: string; limits: Limits; revoked: boolean }>();
  calls: string[] = [];
  private n = 0;
  async issueToken(tenant: string, limits: Limits) {
    this.calls.push(`issue ${tenant}`);
    const token = `token-${++this.n}`;
    this.tenants.set(tenant, { token, limits, revoked: false });
    return token;
  }
  async setLimits(tenant: string, limits: Limits) {
    this.calls.push(`limits ${tenant}`);
    const t = this.tenants.get(tenant);
    if (!t) throw new Error("no such tenant");
    t.limits = limits;
  }
  async revoke(tenant: string) {
    this.calls.push(`revoke ${tenant}`);
    const t = this.tenants.get(tenant);
    if (t) t.revoked = true;
  }
}

class Outbox implements Mailer {
  sent: Mail[] = [];
  failNext = false;
  async send(m: Mail) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("smtp fora do ar");
    }
    this.sent.push(m);
  }
  last(to: string) {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

let server: Server;
let base: string;
let db: Requests;
let node: FakeNode;
let outbox: Outbox;
let config: PortalConfig;
let clock: number;

beforeEach(async () => {
  config = loadConfig({
    PORTAL_PUBLIC_URL: "https://servidor.example/",
    PORTAL_ADMIN_PASSWORD: PASSWORD,
    PORTAL_ADMIN_EMAIL: "admin@example.org",
    PORTAL_MAIL_FROM: "Vamo Virar <servidor@example.org>",
    VV_OPERATOR_TOKEN: "operator-token-0123456789",
    PORTAL_TRUST_PROXY: "1",
  });
  db = new Requests(":memory:");
  node = new FakeNode();
  outbox = new Outbox();
  clock = Date.UTC(2026, 9, 12, 12);
  const handler = createHandler({ config, db, mailer: outbox, node, now: () => clock, log: () => {} });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

let ipCounter = 0;
async function post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `10.0.0.${++ipCounter % 250}`, ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

const valid = {
  name: "Ana Souza",
  email: "Ana@Example.org",
  community: "Comitê Casa Amarela",
  city: "Recife",
  about: "Somos uns 40 vizinhos que organizam mutirões e panfletagens no bairro.",
  terms: "1",
};

function linkIn(mail: Mail | undefined): string {
  const m = /https:\/\/servidor\.example(\/confirmar\?t=[\w-]+)/.exec(mail?.text ?? "");
  expect(m).not.toBeNull();
  return m![1]!;
}

async function adminCookie(): Promise<string> {
  const res = await post("/admin/entrar", { password: PASSWORD });
  expect(res.status).toBe(303);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toMatch(/HttpOnly; SameSite=Strict/);
  expect(cookie).toMatch(/Secure/);
  return cookie.split(";")[0]!;
}

async function confirmedRequest(fields = valid): Promise<number> {
  await post("/pedir", fields);
  const res = await fetch(`${base}${linkIn(outbox.last(fields.email.toLowerCase()))}`);
  expect(res.status).toBe(200);
  return db.list(["pending"])[0]!.id;
}

describe("public request form", () => {
  it("shows the form with security headers", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(await res.text()).toContain('action="/pedir"');
  });

  it("explains what is missing and keeps what was typed", async () => {
    const res = await post("/pedir", { ...valid, email: "nope", terms: "" });
    expect(res.status).toBe(400);
    const page = await res.text();
    expect(page).toContain("Confira o email");
    expect(page).toContain("aceitar os termos");
    expect(page).toContain("Comitê Casa Amarela");
    expect(outbox.sent).toHaveLength(0);
  });

  it("confirms the email before the request reaches the admin", async () => {
    const res = await post("/pedir", valid);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Confira seu email");
    expect(outbox.sent.map((m) => m.to)).toEqual(["ana@example.org"]);
    expect(db.list(["pending"])).toHaveLength(0);

    const link = linkIn(outbox.sent[0]);
    const ok = await fetch(`${base}${link}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Pedido recebido");
    const admin = outbox.last("admin@example.org")!;
    expect(admin.subject).toContain("Comitê Casa Amarela");
    expect(admin.replyTo).toBe("ana@example.org");
    expect(admin.text).toContain(`https://servidor.example/admin/pedidos/`);

    // The link works once, and only for 48 hours.
    expect((await fetch(`${base}${link}`)).status).toBe(400);
    expect(outbox.sent.filter((m) => m.to === "admin@example.org")).toHaveLength(1);
  });

  it("expires unconfirmed requests and reuses one per address", async () => {
    await post("/pedir", valid);
    await post("/pedir", { ...valid, community: "Outro nome" });
    expect(db.list(["unverified"])).toHaveLength(1);
    expect(db.list(["unverified"])[0]!.community).toBe("Outro nome");
    // Only the newest link works.
    const [first, second] = outbox.sent;
    expect((await fetch(`${base}${linkIn(first)}`)).status).toBe(400);
    clock += 49 * 3_600_000;
    expect((await fetch(`${base}${linkIn(second)}`)).status).toBe(400);
    db.purgeUnverified(clock);
    expect(db.list(["unverified"])).toHaveLength(0);
  });

  it("does not take a second request while one waits", async () => {
    await confirmedRequest();
    const res = await post("/pedir", valid);
    expect(await res.text()).toContain("Já existe um pedido");
    expect(outbox.sent).toHaveLength(2);
  });

  it("silently drops bots that fill the hidden field", async () => {
    const res = await post("/pedir", { ...valid, website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(outbox.sent).toHaveLength(0);
  });

  it("limits requests per address", async () => {
    const ip = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 5; i++) {
      expect((await post("/pedir", { ...valid, email: `p${i}@example.org` }, ip)).status).toBe(200);
    }
    expect((await post("/pedir", { ...valid, email: "p9@example.org" }, ip)).status).toBe(429);
  });

  it("escapes what people type", async () => {
    const id = await confirmedRequest({ ...valid, community: '<script>alert("x")</script>' });
    const cookie = await adminCookie();
    const page = await (await fetch(`${base}/admin/pedidos/${id}`, { headers: { cookie } })).text();
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;");
  });
});

describe("admin", () => {
  it("needs the password", async () => {
    const page = await (await fetch(`${base}/admin`)).text();
    expect(page).toContain('type="password"');
    expect((await post("/admin/entrar", { password: "errada" })).status).toBe(401);
    expect((await post("/admin/pedidos/1/aprovar", {})).status).toBe(401);
    const forged = "vv_admin=99999999999999.abc";
    expect((await post("/admin/pedidos/1/aprovar", {}, { cookie: forged })).status).toBe(401);
  });

  it("refuses posts from other sites", async () => {
    const cookie = await adminCookie();
    for (const origin of ["https://evil.example", "null"]) {
      const res = await post("/admin/pedidos/1/aprovar", {}, { cookie, origin });
      expect(res.status).toBe(403);
    }
  });

  it("approves: the node makes a code and the person gets everything by email", async () => {
    const id = await confirmedRequest();
    const cookie = await adminCookie();
    const list = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
    expect(list).toContain("Comitê Casa Amarela");

    const res = await post(`/admin/pedidos/${id}/aprovar`, { max_communities: "2", max_log_mb: "128", max_files_mb: "256" }, { cookie, origin: "https://servidor.example" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/admin/pedidos/${id}?ok=aprovado`);
    const tenant = node.tenants.get(db.get(id)!.tenant!)!;
    expect(tenant.limits).toEqual({ maxCommunities: 2, maxLogBytes: 128 * 1024 * 1024, maxBlobBytes: 256 * 1024 * 1024 });

    const mail = outbox.last("ana@example.org")!;
    expect(mail.subject).toContain("aprovado");
    expect(mail.text).toContain("https://servidor.example\n");
    expect(mail.text).toContain(tenant.token);
    expect(mail.text).toContain("até 2 comunidades");
    expect(mail.text).toContain("Criar uma comunidade");
    expect(mail.html).toContain(tenant.token);
    expect(mail.replyTo).toBe("admin@example.org");
    const r = db.get(id)!;
    expect(r.status).toBe("approved");
    expect(r.tenant).toMatch(new RegExp(`^pedido-${id}-[0-9a-f]{8}$`));

    // A second click does not hand out a second code.
    const again = await post(`/admin/pedidos/${id}/aprovar`, {}, { cookie });
    expect(again.status).toBe(409);
    expect(node.calls).toEqual([`issue ${r.tenant}`]);
  });

  it("revokes the code when the email cannot be sent, and the request waits again", async () => {
    const id = await confirmedRequest();
    const cookie = await adminCookie();
    outbox.failNext = true;
    const res = await post(`/admin/pedidos/${id}/aprovar`, {}, { cookie });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Revoguei o código");
    const tenant = db.get(id)!.tenant!;
    expect(node.calls).toEqual([`issue ${tenant}`, `revoke ${tenant}`]);
    expect(db.get(id)!.status).toBe("pending");

    // Trying again gives the same tenant a fresh code.
    expect((await post(`/admin/pedidos/${id}/aprovar`, {}, { cookie })).status).toBe(303);
    expect(node.tenants.get(db.get(id)!.tenant!)!.revoked).toBe(false);
    expect(outbox.last("ana@example.org")!.text).toContain("token-2");
  });

  it("sends a new code, revokes, and reactivates", async () => {
    const id = await confirmedRequest();
    const cookie = await adminCookie();
    await post(`/admin/pedidos/${id}/aprovar`, {}, { cookie });
    expect((await post(`/admin/pedidos/${id}/novo-codigo`, {}, { cookie })).status).toBe(303);
    const mail = outbox.last("ana@example.org")!;
    expect(mail.subject).toContain("novo código");
    expect(mail.text).toContain("token-2");

    expect((await post(`/admin/pedidos/${id}/revogar`, {}, { cookie })).status).toBe(303);
    expect(node.tenants.get(db.get(id)!.tenant!)!.revoked).toBe(true);
    expect(db.get(id)!.status).toBe("revoked");
    expect((await post(`/admin/pedidos/${id}/revogar`, {}, { cookie })).status).toBe(409);

    expect((await post(`/admin/pedidos/${id}/novo-codigo`, {}, { cookie })).status).toBe(303);
    expect(db.get(id)!.status).toBe("approved");
    expect(node.tenants.get(db.get(id)!.tenant!)!.revoked).toBe(false);
  });

  it("approves with no community limit when the field is empty, and changes limits later", async () => {
    const id = await confirmedRequest();
    const cookie = await adminCookie();
    const page = await (await fetch(`${base}/admin/pedidos/${id}`, { headers: { cookie } })).text();
    expect(page).toContain('placeholder="sem limite" value=""');
    await post(`/admin/pedidos/${id}/aprovar`, { max_communities: "", max_log_mb: "128", max_files_mb: "256" }, { cookie });
    expect(node.tenants.get(db.get(id)!.tenant!)!.limits.maxCommunities).toBeNull();
    expect(db.get(id)!.maxCommunities).toBeNull();
    expect(outbox.last("ana@example.org")!.text).toContain("quantas comunidades precisar");
    expect(await (await fetch(`${base}/admin/pedidos/${id}`, { headers: { cookie } })).text()).toContain("Mudar os limites");

    const res = await post(`/admin/pedidos/${id}/limites`, { max_communities: "3", max_log_mb: "128", max_files_mb: "256" }, { cookie });
    expect(res.headers.get("location")).toBe(`/admin/pedidos/${id}?ok=limites`);
    expect(node.tenants.get(db.get(id)!.tenant!)!.limits).toEqual({ maxCommunities: 3, maxLogBytes: 128 * 1024 * 1024, maxBlobBytes: 256 * 1024 * 1024 });
    expect(db.get(id)!.maxCommunities).toBe(3);

    // A new code keeps the limits the request has now.
    await post(`/admin/pedidos/${id}/novo-codigo`, {}, { cookie });
    expect(node.tenants.get(db.get(id)!.tenant!)!.limits.maxCommunities).toBe(3);
    expect(outbox.last("ana@example.org")!.text).toContain("até 3 comunidades");
  });

  it("changes limits only for approved requests", async () => {
    const id = await confirmedRequest();
    const cookie = await adminCookie();
    expect((await post(`/admin/pedidos/${id}/limites`, { max_communities: "3" }, { cookie })).status).toBe(409);
    expect(node.calls).toEqual([]);
  });

  it("never hands out a code for a tenant an earlier portal database made", async () => {
    // The node outlived a lost portal database: ids start over, its tenants stay.
    const old = await node.issueToken("pedido-1", { maxCommunities: 1, maxLogBytes: 1, maxBlobBytes: 1 });
    const id = await confirmedRequest();
    expect(id).toBe(1);
    const cookie = await adminCookie();
    await post(`/admin/pedidos/${id}/aprovar`, {}, { cookie });
    expect(db.get(id)!.tenant).not.toBe("pedido-1");
    expect(node.tenants.get("pedido-1")!.token).toBe(old);
  });

  it("rejects with a message", async () => {
    const id = await confirmedRequest();
    const cookie = await adminCookie();
    const res = await post(`/admin/pedidos/${id}/recusar`, { reason: "O servidor está cheio este mês." }, { cookie });
    expect(res.status).toBe(303);
    const mail = outbox.last("ana@example.org")!;
    expect(mail.text).toContain("O servidor está cheio este mês.");
    expect(mail.text).toContain("https://vamovirar.app/servidor/");
    expect(db.get(id)!.status).toBe("rejected");
    expect(node.calls).toEqual([]);
    expect((await post(`/admin/pedidos/${id}/aprovar`, {}, { cookie })).status).toBe(409);
  });

  it("logs out", async () => {
    const cookie = await adminCookie();
    const res = await post("/admin/sair", {}, { cookie });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("config", () => {
  it("refuses a short admin password and missing settings", () => {
    const env = {
      PORTAL_PUBLIC_URL: "https://x.example",
      PORTAL_ADMIN_PASSWORD: "curta",
      PORTAL_ADMIN_EMAIL: "a@x.example",
      PORTAL_MAIL_FROM: "a@x.example",
      VV_OPERATOR_TOKEN: "t".repeat(20),
    };
    expect(() => loadConfig(env)).toThrow(/at least 12/);
    expect(() => loadConfig({ ...env, PORTAL_ADMIN_PASSWORD: PASSWORD, PORTAL_MAIL_FROM: "" })).toThrow(/PORTAL_MAIL_FROM/);
    expect(loadConfig({ ...env, PORTAL_ADMIN_PASSWORD: PASSWORD }).nodeUrl).toBe("https://x.example");
  });
});

describe("Railway volume check", () => {
  it("refuses to run on Railway without a volume at the data directory", () => {
    expect(railwayVolumeProblem({}, "/data")).toBeNull();
    expect(railwayVolumeProblem({ RAILWAY_ENVIRONMENT_ID: "e" }, "/data")).toContain("no Railway volume");
    expect(railwayVolumeProblem({ RAILWAY_ENVIRONMENT_ID: "e", RAILWAY_VOLUME_MOUNT_PATH: "/app/data" }, "/data")).toContain("mounted at /app/data");
    expect(railwayVolumeProblem({ RAILWAY_ENVIRONMENT_ID: "e", RAILWAY_VOLUME_MOUNT_PATH: "/data" }, "/data")).toBeNull();
    expect(railwayVolumeProblem({ RAILWAY_ENVIRONMENT_ID: "e", RAILWAY_VOLUME_MOUNT_PATH: "/data" }, "/data/portal")).toBeNull();
  });
});
