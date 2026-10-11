// Markdown <-> the HTML the rich text editor speaks (react-native-enriched-html),
// restricted to what model/markdown understands. Descriptions stay stored as
// Markdown; this HTML exists only inside the editor on this device, so nothing
// here ever renders HTML that came from someone else.
//
// Editor HTML, as the library documents it: <p>, <br>, <h1>–<h6>, <ul>, <ol>,
// <ul data-type="checkbox"> with <li checked>, <blockquote>/<codeblock> holding
// <p> lines, and inline <b> <i> <u> <s> <code> <a href>. Anything else (images,
// mentions, unknown tags) keeps its text and loses its markup.

import { parseMarkdown, type Inline, type ListItem } from "./markdown";

// --- Markdown -> editor HTML ----------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inlineHtml(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return esc(n.text);
        case "strong":
          return `<b>${inlineHtml(n.children)}</b>`;
        case "em":
          return `<i>${inlineHtml(n.children)}</i>`;
        case "code":
          return `<code>${esc(n.text)}</code>`;
        case "link":
          return `<a href="${esc(n.href)}">${inlineHtml(n.children)}</a>`;
      }
    })
    .join("");
}

const itemsHtml = (items: ListItem[]) => items.map((it) => `<li${it.checked ? " checked" : ""}>${inlineHtml(it.children)}</li>`).join("");

/** Markdown to the HTML the editor starts from. */
export function markdownToHtml(src: string): string {
  const out: string[] = [];
  for (const b of parseMarkdown(src)) {
    switch (b.kind) {
      case "heading":
        out.push(`<h${b.level}>${inlineHtml(b.children)}</h${b.level}>`);
        break;
      case "paragraph":
        out.push(`<p>${inlineHtml(b.children)}</p>`);
        break;
      case "list": {
        // A Markdown list may mix plain items and check boxes; the editor keeps them in separate lists.
        let run: ListItem[] = [];
        const flush = () => {
          if (!run.length) return;
          if (run[0]!.checked !== undefined) out.push(`<ul data-type="checkbox">${itemsHtml(run)}</ul>`);
          else out.push(b.ordered ? `<ol>${itemsHtml(run)}</ol>` : `<ul>${itemsHtml(run)}</ul>`);
          run = [];
        };
        for (const it of b.items) {
          if (run.length && (run[0]!.checked !== undefined) !== (it.checked !== undefined)) flush();
          run.push(it);
        }
        flush();
        break;
      }
      case "code":
        out.push(`<codeblock>${b.text.split("\n").map((line) => `<p>${esc(line)}</p>`).join("")}</codeblock>`);
        break;
      case "rule":
        break; // the editor has no rule; it reads as nothing
    }
  }
  return `<html>${out.join("")}</html>`;
}

// --- editor HTML -> Markdown ----------------------------------------------------

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  href?: string;
}

type ListKind = "ul" | "ol" | "check";

interface Line {
  kind: "p" | "h" | "li" | "code";
  level?: number;
  list?: ListKind;
  checked?: boolean;
  runs: Run[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+)))?`, "i").exec(attrs);
  if (!m) return undefined;
  return decode(m[1] ?? m[2] ?? m[3] ?? "");
}

/** Reads editor HTML into lines of formatted runs. */
function readHtml(html: string): Line[] {
  const lines: Line[] = [];
  let line: Line | null = null;
  const lists: ListKind[] = [];
  let codeBlock = 0;
  let bold = 0;
  let italic = 0;
  let code = 0;
  const links: (string | undefined)[] = [];

  const open = (l: Omit<Line, "runs">) => {
    line = { ...l, runs: [] };
    lines.push(line);
  };
  // Text outside any block (a bare string) still lands in a paragraph.
  const current = (): Line => {
    if (!line) open(codeBlock ? { kind: "code" } : { kind: "p" });
    return line!;
  };

  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      const text = decode(m[4]).replace(/[\r\n\t]+/g, codeBlock ? "" : " ");
      if (!text) continue;
      if (!line && !text.trim()) continue; // whitespace between blocks
      current().runs.push({ text, bold: bold > 0, italic: italic > 0, code: code > 0, href: links.at(-1) });
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? "";
    switch (tag) {
      case "b":
      case "strong":
        bold += closing ? -1 : 1;
        break;
      case "i":
      case "em":
        italic += closing ? -1 : 1;
        break;
      case "code":
        code += closing ? -1 : 1;
        break;
      case "a":
        if (closing) links.pop();
        else links.push(attr(attrs, "href"));
        break;
      case "ul":
      case "ol":
        if (closing) lists.pop();
        else lists.push(tag === "ol" ? "ol" : attr(attrs, "data-type") === "checkbox" ? "check" : "ul");
        line = null;
        break;
      case "li":
        if (closing) line = null;
        else {
          open({ kind: "li", list: lists.at(-1) ?? "ul", checked: attr(attrs, "checked") !== undefined });
        }
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        if (closing) line = null;
        else open({ kind: "h", level: Number(tag[1]) });
        break;
      case "p":
        // Inside a list item, a <p> is just the item's text.
        if (line && (line as Line).kind === "li") break;
        if (closing) line = null;
        else open(codeBlock ? { kind: "code" } : { kind: "p" });
        break;
      case "br":
        line = null;
        break;
      case "blockquote":
        line = null; // a quote's <p> lines read as plain paragraphs
        break;
      case "codeblock":
      case "pre":
        codeBlock += closing ? -1 : 1;
        line = null;
        break;
      default:
        break; // html, body, u, s, mention, img, span...: keep the text, drop the markup
    }
  }
  return lines;
}

/** Characters that would start inline formatting; line starts are guarded separately. */
const INLINE_MARKS = "\\`*_[]";
const escapeChars = (s: string) => [...s].map((ch) => (INLINE_MARKS.includes(ch) ? `\\${ch}` : ch)).join("");
/** Escapes formatting characters, leaving web addresses whole so they still read as links. */
const escapeText = (s: string) =>
  s
    .split(/(https?:\/\/[^\s<>)]+)/)
    .map((part, i) => (i % 2 ? part : escapeChars(part)))
    .join("");

/** Wraps `inner` in `mark`, keeping spaces outside so the parser accepts it. */
function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

const SAFE_URL = /^https?:\/\/[^\s<>)]+$/i;

/** A typed web address as a link the reader will follow, or null. "site.org" gets https://. */
export function safeLink(typed: string): string | null {
  let url = typed.trim();
  if (!url) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  return SAFE_URL.test(url) && /^https?:\/\/[^/\s]+\.[^/\s]/i.test(url) ? url : null;
}

/** Groups consecutive runs that agree on `key`. */
function groups<K>(runs: Run[], key: (r: Run) => K): { key: K; runs: Run[] }[] {
  const out: { key: K; runs: Run[] }[] = [];
  for (const r of runs) {
    const k = key(r);
    const last = out.at(-1);
    if (last && last.key === k) last.runs.push(r);
    else out.push({ key: k, runs: [r] });
  }
  return out;
}

function runsMarkdown(runs: Run[]): string {
  return groups(runs, (r) => r.bold)
    .map((b) => {
      const inner = groups(b.runs, (r) => r.italic)
        .map((i) => {
          const inner2 = groups(i.runs, (r) => (r.code ? "\u0000code" : (r.href ?? "")))
            .map((g) => {
              const text = g.runs.map((r) => r.text).join("");
              if (g.key === "\u0000code") return wrap(text.replace(/`/g, "'"), "`");
              const href = g.key as string;
              if (href && SAFE_URL.test(href)) {
                const label = text.replace(/[[\]]/g, "").trim() || href;
                // A link that shows its own address reads back from the bare address.
                return label === href ? href : `[${escapeText(label)}](${href})`;
              }
              return escapeText(text);
            })
            .join("");
          return i.key ? wrap(inner2, "_") : inner2;
        })
        .join("");
      return b.key ? wrap(inner, "**") : inner;
    })
    .join("");
}

/** Keeps a line's first characters from reading as a heading, list, rule or code fence. */
function guardLineStart(s: string): string {
  if (/^(#|>|[-*+]\s|[-*_]{3,}|```)/.test(s)) return `\\${s}`;
  const n = /^(\d+)([.)])(\s)/.exec(s);
  if (n) return `${n[1]}\\${n[2]}${s.slice(n[1]!.length + 1)}`;
  return s;
}

/** Editor HTML to Markdown, in the subset model/markdown reads back the same. */
export function htmlToMarkdown(html: string): string {
  const out: string[] = [];
  let prev: Line | null = null;
  let number = 0;
  let code: string[] = [];
  const flushCode = () => {
    if (code.length) out.push("```\n" + code.join("\n") + "\n```");
    code = [];
  };
  for (const line of readHtml(html)) {
    if (line.kind === "code") {
      code.push(line.runs.map((r) => r.text).join("").replace(/^```/, "'''"));
      prev = line;
      continue;
    }
    flushCode();
    const text = runsMarkdown(line.runs).trim();
    if (!text) continue;
    const body = guardLineStart(text);
    if (line.kind === "h") out.push(`${"#".repeat(Math.min(3, line.level ?? 1))} ${body}`);
    else if (line.kind === "li") {
      const sameList = prev?.kind === "li" && prev.list === line.list;
      number = sameList ? number + 1 : 1;
      const marker = line.list === "ol" ? `${number}.` : line.list === "check" ? `- [${line.checked ? "x" : " "}]` : "-";
      const item = `${marker} ${body}`;
      if (sameList) out[out.length - 1] += `\n${item}`;
      else out.push(item);
    } else out.push(body);
    prev = line;
  }
  flushCode();
  return out.join("\n\n");
}

/** The Markdown the editor would write for `md`: equal results mean the same text and formatting. */
export function normalizeMarkdown(md: string): string {
  return htmlToMarkdown(markdownToHtml(md));
}
