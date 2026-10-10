// Builds /privacidade/, /termos/, /seguranca-infantil/ and /servidor/ from
// docs/*.md so each text has one source.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked, type Tokens } from "marked";
import type { Plugin } from "vite";
import { docUrl } from "../src/ui/landing/links";

const here = dirname(fileURLToPath(import.meta.url));
const docs = (file: string) => resolve(here, "../../../docs", file);

interface Page {
  slug: string;
  file: string;
  /** Short label for the header navigation. */
  nav: string;
  description: string;
}

const pages: Page[] = [
  { slug: "privacidade", file: "privacy-policy.md", nav: "Privacidade", description: "Quais dados o Vamo Virar trata, onde ficam e quais são os seus direitos." },
  { slug: "termos", file: "terms-of-service.md", nav: "Termos", description: "Os Termos de Uso do aplicativo Vamo Virar." },
  {
    slug: "seguranca-infantil",
    file: "child-safety.md",
    nav: "Segurança infantil",
    description: "Padrões do Vamo Virar contra o abuso e a exploração sexual infantil (CSAE): o que é proibido, como denunciar e o que fazemos.",
  },
  {
    slug: "servidor",
    file: "hosting-guide.md",
    nav: "Montar servidor",
    description: "Passo a passo para montar o servidor da sua comunidade num computador seu ou numa VPS barata, de graça ou por poucos dólares por mês.",
  },
];

/** Links between docs become site pages; other docs link to GitHub. */
function mapHref(href: string): string {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [file = "", hash] = href.split("#");
  const page = pages.find((p) => p.file === file);
  if (page) return `/${page.slug}/${hash ? `#${hash}` : ""}`;
  return file.endsWith(".md") ? docUrl(file) + (hash ? `#${hash}` : "") : href;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

marked.use({
  walkTokens(token) {
    if (token.type === "link") token.href = mapHref(token.href);
  },
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
    // Wide tables scroll inside their own box instead of widening the page.
    table(token) {
      return `<div class="scroll" role="region" aria-label="Tabela" tabindex="0">${marked.Renderer.prototype.table.call(this, token)}</div>\n`;
    },
  },
});

const css = `
  :root {
    --bg:#fff; --surface:#f3f2f3; --text:#141414; --muted:#55555e; --border:#dddadc; --link:#0034d2;
    --note:#fff6bf; --note-edge:#ffd400; --brand:#fd0000; --focus:#a237fb;
    --gutter:20px; --measure:720px; --toc:232px; --gap:64px;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0e0e12; --surface:#18181e; --text:#f3f2f3; --muted:#a9a9b3; --border:#33333b; --link:#8fa8ff; --note:#2b2a14; --brand:#ff4d4d; --focus:#c58bff; }
  }
  @media (min-width: 600px) { :root { --gutter:32px; } }
  @media (min-width: 1800px) { :root { --measure:780px; --toc:260px; --gap:96px; } }
  * { box-sizing:border-box; }
  html { -webkit-text-size-adjust:100%; text-size-adjust:100%; scroll-behavior:smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } }
  body { margin:0; background:var(--bg); color:var(--text); font:400 16px/1.7 "Montserrat", system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap:break-word; }
  @media (min-width: 600px) { body { font-size:17px; } }
  @media (min-width: 1800px) { body { font-size:18px; } }
  [id] { scroll-margin-top:24px; }
  a { color:var(--link); text-underline-offset:2px; }
  a:hover { text-decoration-thickness:2px; }
  :focus-visible { outline:3px solid var(--focus); outline-offset:2px; border-radius:2px; }
  .skip { position:absolute; left:8px; top:-100px; background:var(--bg); color:var(--link); padding:8px 12px; font-weight:700; z-index:10; }
  .skip:focus { top:8px; }

  .stripe { display:flex; height:6px; } .stripe i { flex:1; }
  .stripe i:nth-child(1){background:#00b923} .stripe i:nth-child(2){background:#ffd400} .stripe i:nth-child(3){background:#0034d2}
  .wrap { width:100%; max-width:calc(var(--measure) + 2 * var(--gutter)); margin:0 auto; padding:0 var(--gutter); }
  @media (min-width: 1100px) { .wrap { max-width:calc(var(--toc) + var(--gap) + var(--measure) + 2 * var(--gutter)); } }

  header { border-bottom:1px solid var(--border); }
  header .wrap { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; column-gap:24px; row-gap:0; padding-top:12px; padding-bottom:12px; }
  .brand { font:900 22px/1 "Archivo", "Arial Black", sans-serif; text-transform:uppercase; letter-spacing:-.5px; color:var(--brand); text-decoration:none; padding:10px 0; }
  header nav ul { display:flex; flex-wrap:wrap; column-gap:20px; row-gap:0; margin:0; padding:0; list-style:none; }
  header nav a { display:inline-block; padding:10px 0; font-size:15px; font-weight:700; color:var(--text); text-decoration:none; border-bottom:3px solid transparent; }
  header nav a:hover { border-bottom-color:var(--border); }
  header nav a[aria-current="page"] { color:var(--link); border-bottom-color:currentColor; }

  .layout { padding-top:32px; padding-bottom:16px; }
  @media (min-width: 1100px) {
    .layout { display:grid; grid-template-columns:var(--toc) minmax(0, var(--measure)); column-gap:var(--gap); padding-top:56px; }
  }
  main { min-width:0; max-width:var(--measure); }

  .toc-side { display:none; }
  @media (min-width: 1100px) {
    .toc-side { display:block; position:sticky; top:24px; align-self:start; max-height:calc(100vh - 48px); overflow-y:auto; padding:4px 4px 16px 0; }
    .toc-inline { display:none; }
  }
  .toc-title { font:700 12px/1.4 "Montserrat", sans-serif; text-transform:uppercase; letter-spacing:2px; color:var(--muted); margin:0 0 12px; }
  .toc ol { list-style:none; margin:0; padding:0; border-left:2px solid var(--border); }
  .toc li a { display:block; padding:6px 0 6px 14px; margin-left:-2px; border-left:2px solid transparent; color:var(--muted); text-decoration:none; font-size:14px; line-height:1.4; }
  .toc li a:hover { color:var(--text); border-left-color:var(--text); }
  .toc-inline { margin:0 0 32px; background:var(--surface); border-radius:12px; }
  .toc-inline summary { cursor:pointer; padding:14px 16px; font-weight:700; font-size:15px; min-height:48px; list-style-position:inside; }
  .toc-inline ol { margin:0 16px 16px; }

  h1 { font:900 clamp(40px, 9vw, 72px)/.95 "Barlow Condensed", "Arial Narrow", Impact, sans-serif; text-transform:uppercase; letter-spacing:-.5px; color:var(--brand); margin:0 0 20px; text-wrap:balance; }
  h2 { font:900 clamp(21px, 2.6vw, 24px)/1.25 "Archivo", "Arial Black", sans-serif; letter-spacing:-.3px; margin:48px 0 10px; text-wrap:balance; }
  h3 { font:700 1.06em/1.35 "Montserrat", sans-serif; margin:32px 0 6px; }
  p, ul, ol { margin:0 0 16px; }
  main ul, main ol { padding-left:1.4em; }
  li { margin:4px 0; } li::marker { color:var(--muted); }
  code { font-size:.9em; background:#8881; padding:1px 5px; border-radius:4px; }
  pre { margin:0 0 20px; padding:14px 16px; background:var(--surface); border:1px solid var(--border); border-radius:8px; overflow-x:auto; -webkit-overflow-scrolling:touch; font-size:14px; line-height:1.55; }
  pre code { background:none; padding:0; font-size:inherit; white-space:pre-wrap; overflow-wrap:anywhere; }
  li > pre { margin-top:8px; }
  strong { font-weight:700; }
  blockquote { margin:24px 0; padding:16px 20px; background:var(--note); border-left:6px solid var(--note-edge); border-radius:0 8px 8px 0; }
  blockquote p:last-child { margin:0; }
  .scroll { overflow-x:auto; margin:0 0 20px; border:1px solid var(--border); border-radius:8px; -webkit-overflow-scrolling:touch; }
  table { border-collapse:collapse; width:100%; min-width:560px; font-size:14px; line-height:1.5; }
  th, td { border-bottom:1px solid var(--border); padding:10px 12px; text-align:left; vertical-align:top; }
  th { background:var(--surface); font-weight:700; } tr:last-child td { border-bottom:0; }
  td + td, th + th { border-left:1px solid var(--border); }

  footer { border-top:1px solid var(--border); margin-top:56px; color:var(--muted); font-size:15px; }
  footer .wrap { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px 24px; padding-top:20px; padding-bottom:28px; }
  footer ul { display:flex; flex-wrap:wrap; gap:0 20px; margin:0; padding:0; list-style:none; }
  footer a { display:inline-block; padding:10px 0; font-weight:700; }

  @media print {
    header nav, .toc, .skip, .stripe, footer ul { display:none !important; }
    body { font-size:11pt; color:#000; background:#fff; }
    .layout { display:block; padding-top:0; } main { max-width:none; }
    a { color:#000; } h1, h2 { color:#000; break-after:avoid; }
  }
`;

const navList = (current?: string) =>
  `<ul>${pages.map((p) => `<li><a href="/${p.slug}/"${p.slug === current ? ' aria-current="page"' : ""}>${p.nav}</a></li>`).join("")}</ul>`;

function toc(md: string, cls: string): string {
  const items = marked
    .lexer(md)
    .filter((t): t is Tokens.Heading => t.type === "heading" && t.depth === 2)
    .map((h) => `<li><a href="#${slugify(h.text)}">${escape(h.text.replace(/[*_`]/g, ""))}</a></li>`)
    .join("");
  if (!items) return "";
  return cls === "toc-inline"
    ? `<details class="toc toc-inline"><summary>Nesta página</summary><ol>${items}</ol></details>`
    : `<nav class="toc toc-side" aria-label="Nesta página"><p class="toc-title">Nesta página</p><ol>${items}</ol></nav>`;
}

export function renderPage(page: Page): string {
  // The site header already says "Vamo Virar": drop it from the document title.
  const md = readFileSync(docs(page.file), "utf8").replace(/^(#\s+.+?)\s+—\s+Vamo Virar$/m, "$1");
  const title = /^#\s+(.+)$/m.exec(md)?.[1] ?? page.slug;
  const body = marked.parse(md, { async: false }) as string;
  // The inline contents go right after the h1 and the date line.
  const [head = "", ...rest] = body.split(/(?=<h2 )/);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escape(title)} — Vamo Virar</title>
<meta name="description" content="${escape(page.description)}" />
<meta name="theme-color" content="#fd0000" />
<meta property="og:type" content="article" />
<meta property="og:locale" content="pt_BR" />
<meta property="og:title" content="${escape(title)} — Vamo Virar" />
<meta property="og:description" content="${escape(page.description)}" />
<link rel="icon" type="image/png" href="/favicon.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@900&family=Barlow+Condensed:wght@900&family=Montserrat:wght@400;700&display=swap" rel="stylesheet" />
<style>${css}</style>
</head>
<body>
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<div class="stripe" aria-hidden="true"><i></i><i></i><i></i></div>
<header><div class="wrap"><a class="brand" href="/">Vamo Virar</a><nav aria-label="Páginas">${navList(page.slug)}</nav></div></header>
<div class="wrap layout">
${toc(md, "toc-side")}
<main id="conteudo">
${head}${toc(md, "toc-inline")}
${rest.join("")}
</main>
</div>
<footer><div class="wrap"><span>Vamo Virar · Código aberto, licença MIT.</span><nav aria-label="Rodapé"><ul><li><a href="/">Início</a></li>${pages.map((p) => `<li><a href="/${p.slug}/">${p.nav}</a></li>`).join("")}</ul></nav></div></footer>
</body>
</html>
`;
}

/** Serves the doc pages in dev and emits them on build. */
export function legalPages(): Plugin {
  return {
    name: "vv-legal-pages",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const page = pages.find((p) => req.url?.split("?")[0]?.replace(/\/$/, "") === `/${p.slug}`);
        if (!page) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderPage(page));
      });
    },
    generateBundle() {
      for (const page of pages) this.emitFile({ type: "asset", fileName: `${page.slug}/index.html`, source: renderPage(page) });
    },
  };
}
