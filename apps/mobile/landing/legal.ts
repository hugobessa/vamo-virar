// Builds /privacidade/ and /termos/ from docs/*.md so the legal text has one source.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import type { Plugin } from "vite";
import { docUrl } from "../src/ui/landing/links";

const here = dirname(fileURLToPath(import.meta.url));
const docs = (file: string) => resolve(here, "../../../docs", file);

interface Page {
  slug: string;
  file: string;
  description: string;
}

const pages: Page[] = [
  { slug: "privacidade", file: "privacy-policy.md", description: "Quais dados o Vamo Virar trata, onde ficam e quais são os seus direitos." },
  { slug: "termos", file: "terms-of-service.md", description: "Os Termos de Uso do aplicativo Vamo Virar." },
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

marked.use({
  walkTokens(token) {
    if (token.type === "link") token.href = mapHref(token.href);
  },
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

const css = `
  :root { --bg:#fff; --text:#141414; --muted:#55555e; --border:#ddd; --link:#0034d2; --note:#fff6bf; --brand:#fd0000; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e0e12; --text:#f3f2f3; --muted:#a9a9b3; --border:#33333b; --link:#7d9bff; --note:#2b2a14; --brand:#ff3b3b; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:400 17px/1.7 "Montserrat", system-ui, sans-serif; }
  .stripe { display:flex; height:6px; } .stripe i { flex:1; } .stripe i:nth-child(1){background:#00b923} .stripe i:nth-child(2){background:#ffd400} .stripe i:nth-child(3){background:#0034d2}
  header, footer { max-width:760px; margin:0 auto; padding:16px 20px; display:flex; flex-wrap:wrap; gap:16px; justify-content:space-between; align-items:center; }
  header { border-bottom:1px solid var(--border); }
  footer { border-top:1px solid var(--border); margin-top:48px; color:var(--muted); font-size:15px; }
  .brand { font:900 22px "Archivo", sans-serif; text-transform:uppercase; letter-spacing:-.5px; color:var(--brand); text-decoration:none; }
  nav { display:flex; gap:20px; } nav a, footer a { color:var(--link); font-weight:700; text-decoration:underline; padding:8px 0; }
  main { max-width:760px; margin:0 auto; padding:32px 20px 0; }
  h1 { font:900 clamp(40px,8vw,64px)/.95 "Barlow Condensed", sans-serif; text-transform:uppercase; color:var(--brand); margin:0 0 24px; }
  h2 { font:900 22px/1.2 "Archivo", sans-serif; letter-spacing:-.3px; margin:40px 0 8px; }
  h3 { font:700 18px/1.3 "Montserrat", sans-serif; margin:28px 0 4px; }
  a { color:var(--link); } code { font-size:.9em; background:#8881; padding:1px 5px; border-radius:4px; }
  blockquote { margin:20px 0; padding:12px 16px; background:var(--note); border-left:6px solid #ffd400; } blockquote p { margin:0; }
  table { border-collapse:collapse; width:100%; font-size:15px; } th, td { border:1px solid var(--border); padding:8px; text-align:left; vertical-align:top; }
  .scroll { overflow-x:auto; }
`;

export function renderPage(page: Page): string {
  const md = readFileSync(docs(page.file), "utf8");
  const title = /^#\s+(.+)$/m.exec(md)?.[1]?.replace(/\s+—\s+Vamo Virar$/, "") ?? page.slug;
  const body = (marked.parse(md, { async: false }) as string).replace(/<table>/g, '<div class="scroll"><table>').replace(/<\/table>/g, "</table></div>");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Vamo Virar</title>
<meta name="description" content="${page.description}" />
<link rel="icon" type="image/png" href="/favicon.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@900&family=Barlow+Condensed:wght@900&family=Montserrat:wght@400;700&display=swap" rel="stylesheet" />
<style>${css}</style>
</head>
<body>
<div class="stripe"><i></i><i></i><i></i></div>
<header><a class="brand" href="/">Vamo Virar</a><nav><a href="/privacidade/">Privacidade</a><a href="/termos/">Termos</a></nav></header>
<main>
${body}
</main>
<footer><span>Código aberto, licença MIT.</span><a href="/">Voltar ao início</a></footer>
</body>
</html>
`;
}

/** Serves the legal pages in dev and emits them on build. */
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
