// The emails the portal sends, as plain text plus a simple HTML version.

import type { PortalConfig } from "./config.js";
import type { AccessRequest } from "./db.js";
import { esc, megabytes } from "./html.js";
import type { Mail } from "./mailer.js";

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#F3F2F3;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#141414">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
<div style="background:#FD0000;color:#fff;padding:16px 24px;font-weight:800;font-size:20px">Vamo Virar</div>
<div style="padding:24px;line-height:1.5;font-size:16px">
<h1 style="font-size:22px;margin:0 0 16px">${esc(title)}</h1>
${body}
</div></div></body></html>`;
}

const p = (s: string) => `<p style="margin:0 0 16px">${s}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#0034D2;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">${esc(label)}</a></p>`;
const code = (s: string) =>
  `<p style="margin:0 0 16px"><code style="display:block;background:#F6EFE7;border:1px solid #DDDADC;border-radius:8px;padding:12px;font-size:16px;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(s)}</code></p>`;

export function verifyEmail(r: AccessRequest, link: string): Mail {
  return {
    to: r.email,
    subject: "Confirme seu pedido de acesso ao servidor do Vamo Virar",
    text: `Olá, ${r.name}!

Recebemos o seu pedido de acesso ao servidor do Vamo Virar para a comunidade "${r.community}".

Para confirmar que este email é seu, abra o link abaixo (ele vale por 48 horas):

${link}

Se não foi você, ignore esta mensagem: sem a confirmação, o pedido é apagado.
`,
    html: layout(
      "Confirme seu pedido",
      p(`Olá, ${esc(r.name)}!`) +
        p(`Recebemos o seu pedido de acesso ao servidor do Vamo Virar para a comunidade <strong>${esc(r.community)}</strong>.`) +
        p("Para confirmar que este email é seu, toque no botão abaixo. O link vale por 48 horas.") +
        button(link, "Confirmar meu email") +
        p(`<small style="color:#55555E">Se não foi você, ignore esta mensagem: sem a confirmação, o pedido é apagado.</small>`),
    ),
  };
}

export function adminNewRequest(cfg: PortalConfig, r: AccessRequest): Mail {
  const link = `${cfg.publicUrl}/admin/pedidos/${r.id}`;
  return {
    to: cfg.adminEmail,
    replyTo: r.email,
    subject: `Novo pedido de acesso: ${r.community}`,
    text: `${r.name} <${r.email}> pediu acesso para "${r.community}"${r.city ? ` (${r.city})` : ""}.

${r.about}

Aprovar ou recusar: ${link}
`,
    html: layout(
      `Novo pedido: ${r.community}`,
      p(`<strong>${esc(r.name)}</strong> &lt;${esc(r.email)}&gt;${r.city ? ` · ${esc(r.city)}` : ""}`) +
        p(esc(r.about).replace(/\n/g, "<br>")) +
        button(link, "Ver o pedido"),
    ),
  };
}

export function approvedEmail(cfg: PortalConfig, r: AccessRequest, token: string, again = false): Mail {
  const n = r.maxCommunities;
  const allowance = n === null ? "quantas comunidades precisar" : n === 1 ? "1 comunidade" : `até ${n} comunidades`;
  const space = `${megabytes(r.maxLogBytes)} para as informações e ${megabytes(r.maxBlobBytes)} para arquivos anexados, em cada comunidade`;
  const intro = again
    ? "Aqui está um novo código de criação para o servidor do Vamo Virar. O código anterior não funciona mais."
    : `Seu pedido de acesso ao servidor do Vamo Virar para a comunidade "${r.community}" foi aprovado!`;
  return {
    to: r.email,
    subject: again ? "Seu novo código de criação do Vamo Virar" : "Pedido aprovado: crie sua comunidade no Vamo Virar",
    text: `Olá, ${r.name}!

${intro}

Endereço do servidor da comunidade:
${cfg.nodeUrl}

Código de criação:
${token}

Com este código você pode criar ${allowance}.

Como criar a comunidade:

1. Instale o Vamo Virar no celular:
   iPhone: ${cfg.links.appStore}
   Android: ${cfg.links.playStore}
2. Abra o app e toque em "Criar uma comunidade".
3. Preencha o nome da comunidade e o seu nome.
4. Em "Endereço do servidor da comunidade", cole: ${cfg.nodeUrl}
5. Em "Código de criação", cole o código acima.
6. Toque em "Criar". Pronto: agora é só convidar as pessoas pelo app.

As pessoas que você convidar NÃO precisam do endereço nem do código: o link de convite já leva tudo o que elas precisam.

Bom saber:
- Guarde este email. O código só serve para criar comunidades neste servidor; não compartilhe com quem não vai criar uma. Se ele vazar, responda este email que a gente troca.
- Espaço: ${space}.
- Tudo o que a comunidade compartilha é cifrado no celular. Quem cuida do servidor não consegue ler nomes, eventos, agendas nem nada do que vocês combinam.
- Este é um servidor voluntário, sem garantia de que vai estar sempre no ar. Se ele sair do ar, nada se perde: os celulares guardam tudo e sincronizam quando ele voltar. E dá para levar a comunidade para outro servidor quando quiser, pelo app, em Eu > Mudar de servidor (veja ${cfg.links.guide}).
- Ao usar o servidor, você concorda com os termos de uso: ${cfg.links.terms}
`,
    html: layout(
      again ? "Seu novo código de criação" : "Pedido aprovado!",
      p(`Olá, ${esc(r.name)}!`) +
        p(esc(intro)) +
        p("<strong>Endereço do servidor da comunidade</strong>") +
        code(cfg.nodeUrl) +
        p("<strong>Código de criação</strong>") +
        code(token) +
        p(`Com este código você pode criar <strong>${esc(allowance)}</strong>.`) +
        `<h2 style="font-size:18px;margin:24px 0 8px">Como criar a comunidade</h2>
<ol style="margin:0 0 16px;padding-left:20px">
<li>Instale o Vamo Virar no celular: <a href="${esc(cfg.links.appStore)}">iPhone</a> ou <a href="${esc(cfg.links.playStore)}">Android</a>.</li>
<li>Abra o app e toque em <strong>Criar uma comunidade</strong>.</li>
<li>Preencha o nome da comunidade e o seu nome.</li>
<li>Em <strong>Endereço do servidor da comunidade</strong>, cole o endereço acima.</li>
<li>Em <strong>Código de criação</strong>, cole o código acima.</li>
<li>Toque em <strong>Criar</strong>. Pronto: agora é só convidar as pessoas pelo app.</li>
</ol>` +
        p("As pessoas que você convidar <strong>não precisam</strong> do endereço nem do código: o link de convite já leva tudo o que elas precisam.") +
        `<h2 style="font-size:18px;margin:24px 0 8px">Bom saber</h2>
<ul style="margin:0 0 16px;padding-left:20px">
<li>Guarde este email. O código só serve para criar comunidades neste servidor; não compartilhe com quem não vai criar uma. Se ele vazar, responda este email que a gente troca.</li>
<li>Espaço: ${esc(space)}.</li>
<li>Tudo o que a comunidade compartilha é cifrado no celular. Quem cuida do servidor não consegue ler nomes, eventos, agendas nem nada do que vocês combinam.</li>
<li>Este é um servidor voluntário, sem garantia de que vai estar sempre no ar. Se ele sair do ar, nada se perde: os celulares guardam tudo e sincronizam quando ele voltar. E dá para levar a comunidade para outro servidor quando quiser, pelo app, em <strong>Eu › Mudar de servidor</strong> (<a href="${esc(cfg.links.guide)}">veja como</a>).</li>
<li>Ao usar o servidor, você concorda com os <a href="${esc(cfg.links.terms)}">termos de uso</a>.</li>
</ul>`,
    ),
    replyTo: cfg.adminEmail,
  };
}

export function rejectedEmail(cfg: PortalConfig, r: AccessRequest, reason: string): Mail {
  const why = reason.trim();
  return {
    to: r.email,
    replyTo: cfg.adminEmail,
    subject: "Sobre o seu pedido de acesso ao servidor do Vamo Virar",
    text: `Olá, ${r.name}.

Desta vez não foi possível aprovar o pedido de acesso para "${r.community}".
${why ? `\n${why}\n` : ""}
Você ainda pode montar um servidor próprio, de graça num computador seu ou na nuvem, seguindo o guia: ${cfg.links.guide}

Se tiver dúvidas, é só responder este email.
`,
    html: layout(
      "Sobre o seu pedido",
      p(`Olá, ${esc(r.name)}.`) +
        p(`Desta vez não foi possível aprovar o pedido de acesso para <strong>${esc(r.community)}</strong>.`) +
        (why ? p(esc(why).replace(/\n/g, "<br>")) : "") +
        p(`Você ainda pode montar um servidor próprio, de graça num computador seu ou na nuvem, seguindo <a href="${esc(cfg.links.guide)}">o guia</a>.`) +
        p("Se tiver dúvidas, é só responder este email."),
    ),
  };
}
