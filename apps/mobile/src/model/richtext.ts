// Markdown <-> the HTML the rich text editor speaks, restricted to the subset
// model/markdown understands. Descriptions stay stored as Markdown; HTML only
// lives inside the editor on this device.

import { parseMarkdown, type Inline } from "./markdown";

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
          return esc(n.text);
        case "link":
          return `<a href="${esc(n.href)}">${inlineHtml(n.children)}</a>`;
      }
    })
    .join("");
}

/** Markdown to editor HTML. */
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
        const check = b.items.some((it) => it.checked !== undefined);
        const tag = b.ordered ? "ol" : "ul";
        const items = b.items.map((it) => `<li${it.checked ? " checked" : ""}>${inlineHtml(it.children)}</li>`).join("");
        out.push(check ? `<ul data-type="checkbox">${items}</ul>` : `<${tag}>${items}</${tag}>`);
        break;
      }
      case "code":
        for (const line of b.text.split("\n")) out.push(`<p>${esc(line)}</p>`);
        break;
      case "rule":
        break;
    }
  }
  return `<html>${out.join("")}</html>`;
}
