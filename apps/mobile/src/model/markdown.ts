// A small Markdown reader for task descriptions and comments: headings,
// paragraphs, bullet and numbered lists, check boxes, and inline bold,
// italic, code and links. Deliberately no HTML, images or tables: text that
// organizers type on a phone, rendered by the app's own text components.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; items: { checked?: boolean; children: Inline[] }[] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const CHECK = /^\[([ xX])\]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "paragraph", children: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (line.startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1]!.length as 1 | 2 | 3, children: parseInline(h[2]!) });
      continue;
    }
    const li = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (li) {
      flush();
      const ordered = !BULLET.test(line);
      const last = blocks.at(-1);
      const list = last?.kind === "list" && last.ordered === ordered ? last : null;
      const item = parseItem(li[1]!);
      if (list) list.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

function parseItem(text: string): { checked?: boolean; children: Inline[] } {
  const c = CHECK.exec(text);
  if (c) return { checked: c[1] !== " ", children: parseInline(c[2]!) };
  return { children: parseInline(text) };
}

const LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
const URL = /^https?:\/\/[^\s<>)]+/;

const MARKS = [
  ["**", "strong"],
  ["__", "strong"],
  ["*", "em"],
  ["_", "em"],
] as const;

/** A node starting at the head of `rest`, with how much it consumed; null when none applies. */
function matchInline(rest: string, atWordStart: boolean): { node: Inline; length: number } | null {
  if (rest.startsWith("`")) {
    const end = rest.indexOf("`", 1);
    if (end > 1) return { node: { kind: "code", text: rest.slice(1, end) }, length: end + 1 };
  }
  for (const [mark, kind] of MARKS) {
    if (!rest.startsWith(mark) || rest.length <= mark.length * 2 || rest[mark.length] === " ") continue;
    const end = rest.indexOf(mark, mark.length);
    if (end > mark.length && rest[end - 1] !== " ") {
      return { node: { kind, children: parseInline(rest.slice(mark.length, end)) }, length: end + mark.length };
    }
  }
  const link = LINK.exec(rest);
  if (link) return { node: { kind: "link", href: link[2]!, children: parseInline(link[1]!) }, length: link[0].length };
  const url = URL.exec(rest);
  if (url && atWordStart) return { node: { kind: "link", href: url[0], children: [{ kind: "text", text: url[0] }] }, length: url[0].length };
  return null;
}

/** Inline marks. Unbalanced markers are plain text, so nothing a person types disappears. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  for (let i = 0; i < src.length; ) {
    const m = matchInline(src.slice(i), i === 0 || /[\s(]/.test(src[i - 1]!));
    if (m) {
      if (text) out.push({ kind: "text", text });
      text = "";
      out.push(m.node);
      i += m.length;
      continue;
    }
    text += src[i];
    i++;
  }
  if (text) out.push({ kind: "text", text });
  return out;
}

/** The text alone, for previews on cards. */
export function plainText(src: string, max = 140): string {
  const words: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.kind === "text" || n.kind === "code") words.push(n.text);
      else walk(n.children);
    }
  };
  for (const b of parseMarkdown(src)) {
    if (b.kind === "code") words.push(b.text);
    else if (b.kind === "list") b.items.forEach((it) => walk(it.children));
    else if (b.kind !== "rule") walk(b.children);
  }
  const s = words.join(" ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
