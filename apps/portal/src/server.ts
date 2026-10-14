// HTTP routes. Public: the request form and the email confirmation link.
// Admin (password + signed cookie): the queue, approve, reject, new code, revoke.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Limits, PortalConfig } from "./config.js";
import type { AccessRequest, Requests } from "./db.js";
import { adminNewRequest, approvedEmail, rejectedEmail, verifyEmail } from "./emails.js";
import { html } from "./html.js";
import type { Mailer } from "./mailer.js";
import type { NodeOperator } from "./node.js";
import * as pages from "./pages.js";

export interface Deps {
  config: PortalConfig;
  db: Requests;
  mailer: Mailer;
  node: NodeOperator;
  now?: () => number;
  log?: (msg: string) => void;
}

const HOUR = 3_600_000;
const VERIFY_TTL = 48 * HOUR;
const SESSION_TTL = 12 * HOUR;
const MAX_BODY = 32 * 1024;
const MiB = 1024 * 1024;
const COOKIE = "vv_admin";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function sameSecret(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/** Fixed-window counters, e.g. requests per address per hour. */
class RateLimit {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}
  ok(key: string, now: number): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start > this.windowMs) {
      if (this.windows.size > 10_000) this.windows.clear();
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= this.limit;
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) throw new HttpError(415, "formulário esperado");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "formulário grande demais");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  // The confirmation link carries a secret: never send it to other sites in a
  // Referer. ("no-referrer" would also make browsers send `Origin: null` on
  // our own form posts, which the admin origin check rightly refuses.)
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
};

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(body);
}

function redirect(res: ServerResponse, to: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(303, { location: to, "cache-control": "no-store", ...SECURITY_HEADERS, ...headers });
  res.end();
}

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** One line, no control characters, trimmed to `max`. */
const line = (v: string | null, max: number) =>
  (v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
const text = (v: string | null, max: number) =>
  (v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, max);

const FLASH: Record<string, { kind: "good" | "bad"; text: string }> = {
  aprovado: { kind: "good", text: "Aprovado. O código e o passo a passo foram enviados por email." },
  recusado: { kind: "good", text: "Recusado. A pessoa foi avisada por email." },
  "novo-codigo": { kind: "good", text: "Código novo enviado por email. O anterior não funciona mais." },
  limites: { kind: "good", text: "Limites atualizados no servidor. Valem a partir de agora." },
  revogado: { kind: "good", text: "Código revogado. As comunidades que já existem continuam funcionando." },
};

export function createHandler(deps: Deps) {
  const { config: cfg, db, mailer, node } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const requestsPerIp = new RateLimit(5, HOUR);
  const loginsPerIp = new RateLimit(10, HOUR);
  const secure = cfg.publicUrl.startsWith("https://");
  const origin = new URL(cfg.publicUrl).origin;

  function clientIp(req: IncomingMessage): string {
    if (cfg.trustProxy) {
      const xff = req.headers["x-forwarded-for"];
      const last = (Array.isArray(xff) ? xff.join(",") : (xff ?? "")).split(",").pop()?.trim();
      if (last) return last;
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  // ---- admin session: "<expiry>.<hmac>" in an HttpOnly, SameSite=Strict cookie
  const sign = (v: string) => createHmac("sha256", cfg.sessionSecret).update(v).digest("base64url");
  function sessionCookie(value: string, maxAge: number): string {
    return `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }
  function isAdmin(req: IncomingMessage): boolean {
    const cookie = req.headers.cookie ?? "";
    const value = cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!value) return false;
    const [expiry, mac] = value.split(".");
    if (!expiry || !mac || !sameSecret(mac, sign(expiry))) return false;
    return Number(expiry) > now();
  }
  /** Admin forms only accept posts from this site (on top of SameSite=Strict). */
  function sameOrigin(req: IncomingMessage): boolean {
    const o = req.headers.origin;
    return o === undefined || o === origin;
  }

  // ---- public
  async function submitRequest(req: IncomingMessage, res: ServerResponse) {
    const form = await readForm(req);
    const v: pages.FormValues = {
      name: line(form.get("name"), 100),
      email: line(form.get("email"), 200).toLowerCase(),
      community: line(form.get("community"), 120),
      city: line(form.get("city"), 120),
      about: text(form.get("about"), 2000),
      terms: form.get("terms") === "1",
    };
    // Bots fill every field; people never see this one.
    if (form.get("website")) return send(res, 200, pages.checkEmail(v.email));
    const errors: Parameters<typeof pages.requestForm>[2] = {};
    if (!v.name) errors.name = "Diga o seu nome.";
    if (!EMAIL.test(v.email)) errors.email = "Confira o email: é para ele que vai o código.";
    if (!v.community) errors.community = "Diga o nome da comunidade.";
    if (v.about.length < 20) errors.about = "Conte um pouco mais sobre a comunidade (pelo menos uma frase).";
    if (!v.terms) errors.terms = "Para usar o servidor, é preciso aceitar os termos.";
    if (Object.keys(errors).length) return send(res, 400, pages.requestForm(cfg, v, errors));
    if (!requestsPerIp.ok(clientIp(req), now())) {
      return send(res, 429, pages.requestForm(cfg, v, { form: "Muitos pedidos daqui em pouco tempo. Tente de novo daqui a uma hora." }));
    }

    const t = now();
    const secret = randomBytes(32).toString("base64url");
    const link = `${cfg.publicUrl}/confirmar?t=${secret}`;
    const open = db.openFor(v.email);
    const waiting = open.find((r) => r.status !== "unverified");
    if (waiting) {
      return send(res, 200, pages.message("Já existe um pedido", html`<p>Já existe um pedido de <strong>${v.email}</strong> esperando aprovação (para <strong>${waiting.community}</strong>). Você recebe um email assim que ele for decidido.</p>`));
    }
    const fresh = { ...v, verifyHash: sha256(secret), verifyExpires: t + VERIFY_TTL };
    const unverified = open[0];
    let id: number;
    if (unverified) {
      id = unverified.id;
      db.renew(id, fresh);
    } else {
      id = db.create(fresh, t);
    }
    try {
      await mailer.send(verifyEmail(db.get(id)!, link));
    } catch (e) {
      log(`email de confirmação para o pedido ${id} falhou: ${(e as Error).message}`);
      return send(res, 502, pages.requestForm(cfg, v, { form: "Não conseguimos enviar o email de confirmação agora. Tente de novo em alguns minutos." }));
    }
    send(res, 200, pages.checkEmail(v.email));
  }

  async function confirm(url: URL, res: ServerResponse) {
    const secret = url.searchParams.get("t") ?? "";
    const r = secret ? db.verify(sha256(secret), now()) : undefined;
    if (!r || r === "expired") return send(res, 400, pages.badLink());
    try {
      await mailer.send(adminNewRequest(cfg, r));
    } catch (e) {
      log(`aviso do pedido ${r.id} para o admin falhou: ${(e as Error).message}`);
    }
    send(res, 200, pages.confirmed(r));
  }

  // ---- admin
  function limitsFrom(form: URLSearchParams): Limits {
    const n = (k: string, min: number, max: number, fallback: number) => {
      const v = Number(form.get(k));
      return Number.isInteger(v) && v >= min && v <= max ? v : fallback;
    };
    return {
      // Empty: no limit on how many communities the code creates.
      maxCommunities: form.get("max_communities")?.trim() ? n("max_communities", 1, 1000, cfg.defaults.maxCommunities ?? 1) : null,
      maxLogBytes: n("max_log_mb", 16, 65536, cfg.defaults.maxLogBytes / MiB) * MiB,
      maxBlobBytes: n("max_files_mb", 0, 65536, cfg.defaults.maxBlobBytes / MiB) * MiB,
    };
  }

  /** Gets a code from the node and emails it. If the email fails, the code
   * is revoked again so no working code exists that nobody received. */
  async function issue(r: AccessRequest, limits: Limits, again: boolean): Promise<string | null> {
    const tenant = r.tenant ?? `pedido-${r.id}`;
    let token: string;
    try {
      token = await node.issueToken(tenant, limits);
    } catch (e) {
      log(`pedido ${r.id}: ${(e as Error).message}`);
      return `Não consegui gerar o código no nó: ${(e as Error).message}`;
    }
    const approved: AccessRequest = { ...r, tenant, ...limits };
    try {
      await mailer.send(approvedEmail(cfg, approved, token, again));
    } catch (e) {
      log(`pedido ${r.id}: email com o código falhou: ${(e as Error).message}`);
      await node.revoke(tenant).catch((err: Error) => log(`pedido ${r.id}: revogar depois da falha também falhou: ${err.message}`));
      return `O código foi gerado, mas o email não saiu (${(e as Error).message}). Revoguei o código; tente de novo.`;
    }
    db.transition(r.id, ["approving"], "approved", now(), { tenant, ...limits });
    return null;
  }

  async function adminAction(id: number, action: string, req: IncomingMessage, res: ServerResponse) {
    const form = await readForm(req);
    const r = db.get(id);
    if (!r) return send(res, 404, pages.message("Não encontrado", html`<p>Esse pedido não existe.</p>`, "bad"));
    const fail = (status: number, text: string) => send(res, status, pages.adminDetail(db.get(id)!, cfg.defaults, { kind: "bad", text }));
    const t = now();

    if (action === "aprovar") {
      const limits = limitsFrom(form);
      if (!db.transition(id, ["pending"], "approving", t)) return fail(409, "Este pedido não está mais esperando aprovação.");
      const error = await issue(r, limits, false);
      if (error) {
        db.transition(id, ["approving"], "pending", t);
        return fail(502, error);
      }
      log(`pedido ${id} aprovado`);
      return redirect(res, `/admin/pedidos/${id}?ok=aprovado`);
    }
    if (action === "novo-codigo") {
      const from = r.status;
      if ((from !== "approved" && from !== "revoked") || !db.transition(id, [from], "approving", t)) {
        return fail(409, "Só dá para enviar um código novo para pedidos aprovados.");
      }
      const limits = { maxCommunities: r.maxCommunities, maxLogBytes: r.maxLogBytes ?? cfg.defaults.maxLogBytes, maxBlobBytes: r.maxBlobBytes ?? cfg.defaults.maxBlobBytes };
      const error = await issue(r, limits, true);
      if (error) {
        // The node already replaced (then revoked) the old code.
        db.transition(id, ["approving"], "revoked", t);
        return fail(502, error);
      }
      log(`pedido ${id}: código novo enviado`);
      return redirect(res, `/admin/pedidos/${id}?ok=novo-codigo`);
    }
    if (action === "limites") {
      if ((r.status !== "approved" && r.status !== "revoked") || !r.tenant) return fail(409, "Só dá para mudar os limites de pedidos aprovados.");
      const limits = limitsFrom(form);
      try {
        await node.setLimits(r.tenant, limits);
      } catch (e) {
        return fail(502, (e as Error).message);
      }
      db.setLimits(id, limits);
      log(`pedido ${id}: limites mudados`);
      return redirect(res, `/admin/pedidos/${id}?ok=limites`);
    }
    if (action === "revogar") {
      if (r.status !== "approved" || !r.tenant) return fail(409, "Só dá para revogar pedidos aprovados.");
      try {
        await node.revoke(r.tenant);
      } catch (e) {
        return fail(502, (e as Error).message);
      }
      db.transition(id, ["approved"], "revoked", t);
      log(`pedido ${id}: código revogado`);
      return redirect(res, `/admin/pedidos/${id}?ok=revogado`);
    }
    if (action === "recusar") {
      const reason = text(form.get("reason"), 2000);
      if (!db.transition(id, ["pending"], "rejected", t, { reason: reason || null })) return fail(409, "Este pedido não está mais esperando aprovação.");
      try {
        await mailer.send(rejectedEmail(cfg, r, reason));
      } catch (e) {
        log(`pedido ${id}: email de recusa falhou: ${(e as Error).message}`);
        return fail(502, `Recusado, mas o email não saiu (${(e as Error).message}). Avise a pessoa por outro meio: ${r.email}.`);
      }
      log(`pedido ${id} recusado`);
      return redirect(res, `/admin/pedidos/${id}?ok=recusado`);
    }
    send(res, 404, pages.message("Não encontrado", html`<p>Essa ação não existe.</p>`, "bad"));
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://portal");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/estilo.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600", ...SECURITY_HEADERS });
      return res.end(pages.CSS);
    }
    if (method === "GET" && path === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("ok");
    }
    if (method === "GET" && path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("User-agent: *\nDisallow: /admin\nDisallow: /confirmar\n");
    }
    if (method === "GET" && path === "/") return send(res, 200, pages.requestForm(cfg));
    if (method === "POST" && path === "/pedir") return submitRequest(req, res);
    if (method === "GET" && path === "/confirmar") return confirm(url, res);

    if (path === "/admin" || path.startsWith("/admin/")) {
      if (method === "POST" && !sameOrigin(req)) throw new HttpError(403, "origem inválida");
      if (method === "POST" && path === "/admin/entrar") {
        if (!loginsPerIp.ok(clientIp(req), now())) return send(res, 429, pages.login("Muitas tentativas. Espere uma hora."));
        const form = await readForm(req);
        if (!sameSecret(form.get("password") ?? "", cfg.adminPassword)) {
          log(`login do admin recusado (${clientIp(req)})`);
          return send(res, 401, pages.login("Senha errada."));
        }
        const expiry = String(now() + SESSION_TTL);
        return redirect(res, "/admin", { "set-cookie": sessionCookie(`${expiry}.${sign(expiry)}`, SESSION_TTL / 1000) });
      }
      if (method === "POST" && path === "/admin/sair") {
        return redirect(res, "/admin", { "set-cookie": sessionCookie("", 0) });
      }
      if (!isAdmin(req)) {
        if (method === "GET") return send(res, 200, pages.login());
        throw new HttpError(401, "entre de novo");
      }
      if (method === "GET" && path === "/admin") {
        return send(
          res,
          200,
          pages.adminList(db.list(["pending", "approving"]), db.list(["approved", "rejected", "revoked"]), db.list(["unverified"])),
        );
      }
      const m = /^\/admin\/pedidos\/(\d+)(?:\/([a-z-]+))?$/.exec(path);
      if (m) {
        const id = Number(m[1]);
        if (method === "GET" && !m[2]) {
          const r = db.get(id);
          if (!r) return send(res, 404, pages.message("Não encontrado", html`<p>Esse pedido não existe.</p>`, "bad"));
          return send(res, 200, pages.adminDetail(r, cfg.defaults, FLASH[url.searchParams.get("ok") ?? ""]));
        }
        if (method === "POST" && m[2]) return adminAction(id, m[2], req, res);
      }
    }
    send(res, 404, pages.message("Página não encontrada", html`<p><a href="/">Voltar ao início</a></p>`, "bad"));
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      await route(req, res);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return send(res, e.status, pages.message("Não deu certo", html`<p>${e.message}</p>`, "bad"));
      log(`erro: ${(e as Error).stack ?? e}`);
      send(res, 500, pages.message("Erro", html`<p>Algo deu errado do nosso lado. Tente de novo em alguns minutos.</p>`, "bad"));
    }
  };
}
