import { describe, expect, it } from "vitest";
import { checklistProgress, parseInline, parseMarkdown, plainText, toggleCheck } from "./markdown";

describe("markdown blocks", () => {
  it("reads headings, paragraphs, lists, check boxes, code and rules", () => {
    const blocks = parseMarkdown(["# Plano", "", "Primeira linha", "segunda linha do parágrafo", "", "- [ ] som", "- [x] faixas", "1. imprimir", "2) distribuir", "", "```", "x = 1", "```", "---"].join("\n"));
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "code", "rule"]);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(blocks[1]).toEqual({ kind: "paragraph", children: [{ kind: "text", text: "Primeira linha segunda linha do parágrafo" }] });
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: false, items: [{ checked: false }, { checked: true }] });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true, items: [{ children: [{ text: "imprimir" }] }, { children: [{ text: "distribuir" }] }] });
    expect(blocks[4]).toEqual({ kind: "code", text: "x = 1" });
  });

  it("ignores HTML and keeps text that only looks like markdown", () => {
    expect(parseMarkdown("<b>oi</b>")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "<b>oi</b>" }] }]);
    expect(parseMarkdown("#semespaco")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "#semespaco" }] }]);
  });
});

describe("inline marks", () => {
  it("reads bold, italic, code and links", () => {
    expect(parseInline("a **b** _c_ `d` [e](https://x.y/z) https://w.q/r")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "c" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
      { kind: "text", text: " " },
      { kind: "link", href: "https://x.y/z", children: [{ kind: "text", text: "e" }] },
      { kind: "text", text: " " },
      { kind: "link", href: "https://w.q/r", children: [{ kind: "text", text: "https://w.q/r" }] },
    ]);
  });

  it("leaves unbalanced markers and non-http links as text", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
    expect(parseInline("a_b_c")).toEqual([{ kind: "text", text: "a" }, { kind: "em", children: [{ kind: "text", text: "b" }] }, { kind: "text", text: "c" }]);
    expect(parseInline("**")).toEqual([{ kind: "text", text: "**" }]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
  });
});

describe("plain text", () => {
  it("flattens and truncates", () => {
    expect(plainText("# Oi\n\n- **a**\n- b")).toBe("Oi a b");
    expect(plainText("x".repeat(200), 10)).toBe("xxxxxxxxx…");
  });
});

describe("check boxes", () => {
  const src = ["Precisamos de:", "- [ ] caixa de som", "- [x] microfone", "* [ ] extensão de **10 m**", "", "```", "- [ ] não é item", "```"].join("\n");

  it("knows the line of each box and ticks only that one", () => {
    const list = parseMarkdown(src)[1];
    expect(list).toMatchObject({ kind: "list", items: [{ checked: false, line: 1 }, { checked: true, line: 2 }, { checked: false, line: 3 }] });
    expect(toggleCheck(src, 1).split("\n")[1]).toBe("- [x] caixa de som");
    expect(toggleCheck(src, 2).split("\n")[2]).toBe("- [ ] microfone");
    expect(toggleCheck(src, 3).split("\n")[3]).toBe("* [x] extensão de **10 m**");
    expect(toggleCheck(toggleCheck(src, 1), 1)).toBe(src);
  });

  it("leaves lines that are not boxes alone", () => {
    expect(toggleCheck(src, 0)).toBe(src);
    expect(toggleCheck(src, 99)).toBe(src);
  });

  it("counts ticked boxes, not code", () => {
    expect(checklistProgress(src)).toEqual({ done: 1, total: 3 });
    expect(checklistProgress("sem caixas")).toEqual({ done: 0, total: 0 });
  });
});

describe("escapes", () => {
  it("keeps escaped punctuation as text", () => {
    expect(parseInline("2 \\* 3 \\* 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
    expect(parseInline("\\*não é itálico\\*")).toEqual([{ kind: "text", text: "*não é itálico*" }]);
    expect(parseMarkdown("\\# não é título")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "# não é título" }] }]);
  });

  it("does not close a mark on an escaped one", () => {
    expect(parseInline("**a \\** b**")).toEqual([{ kind: "strong", children: [{ kind: "text", text: "a ** b" }] }]);
  });

  it("leaves other backslashes alone", () => {
    expect(parseInline("C:\\pasta\\novo")).toEqual([{ kind: "text", text: "C:\\pasta\\novo" }]);
  });
});
