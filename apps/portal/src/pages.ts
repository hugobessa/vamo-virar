// Server-rendered pages. No JavaScript: plain forms, so the page works on any
// phone and the Content-Security-Policy can forbid scripts outright.

import type { Limits, PortalConfig } from "./config.js";
import type { AccessRequest, Status } from "./db.js";
import { html, megabytes, raw, type Safe } from "./html.js";

export const CSS = `
:root{color-scheme:light dark;--bg:#F3F2F3;--card:#fff;--text:#141414;--muted:#55555E;--border:#DDDADC;--brand:#FD0000;--primary:#0034D2;--primary-text:#fff;--accent:#FFD400;--danger:#A20301;--ok:#006820;--field:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0E0E12;--card:#1A1A20;--text:#F3F2F3;--muted:#A9A9B3;--border:#33333B;--brand:#FF3B3B;--primary:#7D9BFF;--primary-text:#0A1233;--danger:#FF8A80;--ok:#3DD65C;--field:#0E0E12}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:var(--brand);color:#fff;padding:14px 16px}
header .in{max-width:720px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:12px}
header a{color:#fff;text-decoration:none;font-weight:800;font-size:20px}
header form{margin:0}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin:0 0 16px}
h1{font-size:28px;line-height:1.2;margin:0 0 12px}
h2{font-size:20px;margin:0 0 12px}
p{margin:0 0 12px}
.muted{color:var(--muted)}
label{display:block;font-weight:600;margin:16px 0 4px}
.help{font-weight:400;color:var(--muted);font-size:14px}
input[type=text],input[type=email],input[type=password],input[type=number],textarea{width:100%;font:inherit;color:inherit;background:var(--field);border:1px solid var(--border);border-radius:8px;padding:10px 12px}
textarea{min-height:120px;resize:vertical}
input:focus,textarea:focus,button:focus{outline:3px solid #A237FB;outline-offset:1px}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400}
.check input{margin-top:5px}
button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:12px 20px;cursor:pointer;background:var(--primary);color:var(--primary-text)}
button.secondary{background:transparent;color:var(--text);border:1px solid var(--border)}
button.danger{background:transparent;color:var(--danger);border:1px solid var(--danger)}
header button{padding:6px 12px;background:transparent;color:#fff;border:1px solid #fff}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.error{color:var(--danger);font-size:14px;margin:4px 0 0}
.banner{border-left:4px solid var(--primary);padding:12px 16px;background:var(--card);border-radius:8px;margin:0 0 16px}
.banner.bad{border-color:var(--danger)}
.banner.good{border-color:var(--ok)}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
table{width:100%;border-collapse:collapse}
td,th{text-align:left;padding:8px 6px;border-bottom:1px solid var(--border);vertical-align:top}
th{font-size:14px;color:var(--muted);font-weight:600}
.pill{display:inline-block;font-size:13px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid var(--border)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0 16px}
.about{white-space:pre-wrap;overflow-wrap:anywhere}
a{color:var(--primary)}
`;

function page(title: string, body: Safe, opts: { admin?: boolean; signedIn?: boolean } = {}): string {
  return `<!doctype html>${html`<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Vamo Virar</title><meta name="robots" content="${opts.admin ? "noindex" : "index"}">
<link rel="stylesheet" href="/estilo.css"></head><body>
<header><div class="in"><a href="${opts.admin ? "/admin" : "/"}">Vamo Virar${opts.admin ? " · pedidos" : ""}</a>${
    opts.signedIn ? raw(`<form method="post" action="/admin/sair"><button type="submit">Sair</button></form>`) : ""
  }</div></header>
<main>${body}</main></body></html>`.value}`;
}

export interface FormValues {
  name: string;
  email: string;
  community: string;
  about: string;
  city: string;
  terms: boolean;
}

export const emptyForm: FormValues = { name: "", email: "", community: "", about: "", city: "", terms: false };

export function requestForm(cfg: PortalConfig, v: FormValues = emptyForm, errors: Partial<Record<keyof FormValues | "form", string>> = {}): string {
  const err = (k: keyof typeof errors) => (errors[k] ? html`<p class="error">${errors[k]}</p>` : "");
  return page(
    "Pedir acesso ao servidor",
    html`<h1>Crie sua comunidade no servidor do Vamo Virar</h1>
<p>Este servidor é mantido por voluntários para comunidades que querem usar o <a href="https://vamovirar.app">Vamo Virar</a> sem montar nem pagar um servidor próprio. Conte um pouco sobre a sua comunidade: assim que o pedido for aprovado, você recebe por email o endereço e o código para criá-la no app.</p>
<p class="muted">Só quem vai <strong>criar</strong> a comunidade precisa pedir. Quem vai participar só precisa do link de convite.</p>
${errors.form ? html`<div class="banner bad">${errors.form}</div>` : ""}
<form class="card" method="post" action="/pedir" novalidate>
<label for="name">Seu nome</label>
<input type="text" id="name" name="name" autocomplete="name" maxlength="100" required value="${v.name}">${err("name")}
<label for="email">Seu email <span class="help">· é para onde vai o código</span></label>
<input type="email" id="email" name="email" autocomplete="email" maxlength="200" required value="${v.email}">${err("email")}
<label for="community">Nome da comunidade</label>
<input type="text" id="community" name="community" maxlength="120" required value="${v.community}">${err("community")}
<label for="city">Cidade ou região <span class="help">· opcional</span></label>
<input type="text" id="city" name="city" maxlength="120" value="${v.city}">
<label for="about">Conte sobre a comunidade <span class="help">· quem são, o que organizam, mais ou menos quantas pessoas</span></label>
<textarea id="about" name="about" maxlength="2000" required>${v.about}</textarea>${err("about")}
<div class="hp" aria-hidden="true"><label for="website">Não preencha</label><input type="text" id="website" name="website" tabindex="-1" autocomplete="off"></div>
<label class="check"><input type="checkbox" name="terms" value="1"${v.terms ? raw(" checked") : ""}> <span>Li e aceito os <a href="${cfg.links.terms}">termos de uso</a> e a <a href="${cfg.links.privacy}">política de privacidade</a>.</span></label>${err("terms")}
<div class="actions"><button type="submit">Pedir acesso</button></div>
</form>
<p class="muted">Prefere ter o seu próprio servidor? <a href="${cfg.links.guide}">Veja como montar um</a>, de graça num computador seu ou na nuvem.</p>`,
  );
}

export function message(title: string, body: Safe, kind: "good" | "bad" | "" = ""): string {
  return page(title, html`<h1>${title}</h1><div class="banner ${kind}">${body}</div>`);
}

export const checkEmail = (email: string) =>
  message(
    "Confira seu email",
    html`<p>Enviamos um link de confirmação para <strong>${email}</strong>. Abra o email e toque em <strong>Confirmar meu email</strong> para o pedido seguir para aprovação.</p><p class="muted">Não chegou? Olhe a caixa de spam. O link vale por 48 horas.</p>`,
    "good",
  );

export const confirmed = (r: AccessRequest) =>
  message(
    "Pedido recebido",
    html`<p>Obrigado, ${r.name}! O pedido para <strong>${r.community}</strong> foi confirmado e está esperando aprovação.</p><p>Quando ele for aprovado, você recebe em <strong>${r.email}</strong> o endereço do servidor e o código para criar a comunidade, com o passo a passo.</p>`,
    "good",
  );

export const badLink = () =>
  message(
    "Link inválido",
    html`<p>Este link de confirmação não vale mais. Ele pode ter expirado (vale por 48 horas) ou já ter sido usado.</p><p><a href="/">Fazer um novo pedido</a></p>`,
    "bad",
  );

// ----------------------------------------------------------------- admin

export function login(error?: string): string {
  return page(
    "Entrar",
    html`<h1>Pedidos de acesso</h1>
${error ? html`<div class="banner bad">${error}</div>` : ""}
<form class="card" method="post" action="/admin/entrar">
<label for="password">Senha</label>
<input type="password" id="password" name="password" autocomplete="current-password" required autofocus>
<div class="actions"><button type="submit">Entrar</button></div>
</form>`,
    { admin: true, signedIn: false },
  );
}

const STATUS: Record<Status, string> = {
  unverified: "email não confirmado",
  pending: "esperando aprovação",
  approving: "aprovando…",
  approved: "aprovado",
  rejected: "recusado",
  revoked: "acesso revogado",
};

const date = (ms: number | null) =>
  ms === null ? "—" : new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

function table(rows: AccessRequest[], empty: string): Safe {
  if (!rows.length) return html`<p class="muted">${empty}</p>`;
  return html`<table><thead><tr><th>Comunidade</th><th>Quem pediu</th><th>Data</th><th>Situação</th></tr></thead><tbody>${rows.map(
    (r) => html`<tr><td><a href="/admin/pedidos/${r.id}">${r.community}</a></td><td>${r.name}<br><span class="muted">${r.email}</span></td><td>${date(r.createdAt)}</td><td><span class="pill">${STATUS[r.status]}</span></td></tr>`,
  )}</tbody></table>`;
}

export function adminList(waiting: AccessRequest[], decided: AccessRequest[], unverified: AccessRequest[]): string {
  return page(
    "Pedidos",
    html`<h1>Pedidos de acesso</h1>
<section class="card"><h2>Esperando aprovação (${waiting.length})</h2>${table(waiting, "Nenhum pedido esperando. 🎉")}</section>
<section class="card"><h2>Decididos</h2>${table(decided, "Nada por aqui ainda.")}</section>
<section class="card"><h2>Email não confirmado</h2><p class="muted">Somem sozinhos se ninguém confirmar em 48 horas.</p>${table(unverified, "Nenhum.")}</section>`,
    { admin: true, signedIn: true },
  );
}

export function adminDetail(r: AccessRequest, defaults: Limits, flash?: { kind: "good" | "bad"; text: string }): string {
  const mb = (b: number) => Math.round(b / (1024 * 1024));
  const fields = (l: Limits) => html`<div class="grid">
<div><label for="max_communities">Comunidades</label><input type="number" id="max_communities" name="max_communities" min="1" max="1000" placeholder="sem limite" value="${l.maxCommunities ?? ""}"></div>
<div><label for="max_log_mb">Informações (MB)</label><input type="number" id="max_log_mb" name="max_log_mb" min="16" max="65536" value="${mb(l.maxLogBytes)}"></div>
<div><label for="max_files_mb">Arquivos (MB)</label><input type="number" id="max_files_mb" name="max_files_mb" min="0" max="65536" value="${mb(l.maxBlobBytes)}"></div>
</div>
<p class="help">Comunidades: quantas este código pode criar; em branco, sem limite. Informações e arquivos: por comunidade.</p>`;
  const current: Limits = {
    maxCommunities: r.maxCommunities,
    maxLogBytes: r.maxLogBytes ?? defaults.maxLogBytes,
    maxBlobBytes: r.maxBlobBytes ?? defaults.maxBlobBytes,
  };
  const decision =
    r.status === "pending"
      ? html`<form class="card" method="post" action="/admin/pedidos/${r.id}/aprovar">
<h2>Aprovar</h2>
<p class="muted">O nó gera um código de criação só para este pedido e o portal envia por email, com o passo a passo. O código não fica guardado aqui.</p>
${fields(defaults)}
<div class="actions"><button type="submit">Aprovar e enviar o código</button></div>
</form>
<form class="card" method="post" action="/admin/pedidos/${r.id}/recusar">
<h2>Recusar</h2>
<label for="reason">Mensagem para a pessoa <span class="help">· opcional, vai no email</span></label>
<textarea id="reason" name="reason" maxlength="2000"></textarea>
<div class="actions"><button type="submit" class="danger">Recusar e avisar por email</button></div>
</form>`
      : r.status === "approved" || r.status === "revoked"
        ? html`<section class="card"><h2>Acesso</h2>
<p>Comunidades: <strong>${r.maxCommunities ?? "sem limite"}</strong> · informações: <strong>${megabytes(r.maxLogBytes)}</strong> · arquivos: <strong>${megabytes(r.maxBlobBytes)}</strong> por comunidade.</p>
<p class="muted">No nó, este acesso se chama <code>${r.tenant}</code> (veja o uso em <code>/operator/v1/tenants</code>).</p>
<div class="actions">
<form method="post" action="/admin/pedidos/${r.id}/novo-codigo"><button type="submit" class="secondary">${r.status === "revoked" ? "Reativar com um código novo" : "Enviar um código novo"}</button></form>
${r.status === "approved" ? html`<form method="post" action="/admin/pedidos/${r.id}/revogar"><button type="submit" class="danger">Revogar o código</button></form>` : ""}
</div>
<p class="help">Um código novo invalida o anterior. Revogar impede criar comunidades novas; as que já existem continuam funcionando e podem mudar de servidor.</p>
</section>
<form class="card" method="post" action="/admin/pedidos/${r.id}/limites">
<h2>Mudar os limites</h2>
<p class="muted">Vale na hora, sem precisar de um código novo. O que já passou de um limite menor continua funcionando; só não cresce mais.</p>
${fields(current)}
<div class="actions"><button type="submit" class="secondary">Salvar os limites</button></div>
</form>`
        : "";
  return page(
    r.community,
    html`<p><a href="/admin">← Pedidos</a></p>
${flash ? html`<div class="banner ${flash.kind}">${flash.text}</div>` : ""}
<section class="card">
<h1>${r.community}</h1>
<p><span class="pill">${STATUS[r.status]}</span></p>
<p><strong>${r.name}</strong> · <a href="mailto:${r.email}">${r.email}</a>${r.city ? html` · ${r.city}` : ""}</p>
<p class="about">${r.about}</p>
<p class="muted">Pedido em ${date(r.createdAt)} · email confirmado em ${date(r.verifiedAt)}${r.decidedAt ? html` · decidido em ${date(r.decidedAt)}` : ""}</p>
${r.reason ? html`<p class="muted">Mensagem da recusa: ${r.reason}</p>` : ""}
</section>
${decision}`,
    { admin: true, signedIn: true },
  );
}
