import { describe, expect, it } from "vitest";
import { parseMarkdown, plainText } from "./markdown";
import { htmlToMarkdown, markdownToHtml, safeLink } from "./richtext";

/** What the reader sees, ignoring rules (the editor has none). */
const shape = (md: string) => parseMarkdown(md).filter((b) => b.kind !== "rule");
/** Markdown -> editor -> Markdown. */
const roundTrip = (md: string) => htmlToMarkdown(markdownToHtml(md));

describe("markdown to editor HTML", () => {
  it("writes the editor's own tags", () => {
    expect(markdownToHtml("Combinar com o **Zé** e _Ana_\n\n- [ ] som\n- [x] faixa")).toBe(
      '<html><p>Combinar com o <b>Zé</b> e <i>Ana</i></p><ul data-type="checkbox"><li>som</li><li checked>faixa</li></ul></html>',
    );
    expect(markdownToHtml("# Plano\n\n1. um\n2. dois\n\n- a\n- b")).toBe("<html><h1>Plano</h1><ol><li>um</li><li>dois</li></ol><ul><li>a</li><li>b</li></ul></html>");
    expect(markdownToHtml("Veja [o mapa](https://example.org/m?a=1&b=2)")).toBe('<html><p>Veja <a href="https://example.org/m?a=1&amp;b=2">o mapa</a></p></html>');
  });

  it("escapes text, so typed angle brackets stay text", () => {
    expect(markdownToHtml('<script>alert("x")</script> & mais')).toBe("<html><p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; mais</p></html>");
  });

  it("splits a list that mixes check boxes and bullets", () => {
    expect(markdownToHtml("- a\n- [ ] b\n- c")).toBe('<html><ul><li>a</li></ul><ul data-type="checkbox"><li>b</li></ul><ul><li>c</li></ul></html>');
  });
});

describe("editor HTML to markdown", () => {
  it("reads what the editor writes", () => {
    expect(
      htmlToMarkdown('<html><p>Combinar com o <b>Zé</b> quem leva o quê:</p><ul data-type="checkbox"><li>caixa de som</li><li checked>microfone</li></ul></html>'),
    ).toBe("Combinar com o **Zé** quem leva o quê:\n\n- [ ] caixa de som\n- [x] microfone");
    expect(htmlToMarkdown("<html><h2>Plano</h2><ol><li>um</li><li>dois</li></ol><ul><li>a</li></ul></html>")).toBe("## Plano\n\n1. um\n2. dois\n\n- a");
    expect(htmlToMarkdown('<html><p>ver <a href="https://example.org/x">o mapa</a></p></html>')).toBe("ver [o mapa](https://example.org/x)");
  });

  it("keeps spaces outside the marks and nests bold and italic", () => {
    expect(htmlToMarkdown("<p>a<b> negrito </b>b</p>")).toBe("a **negrito** b");
    expect(htmlToMarkdown("<p><b>tudo <i>junto</i></b> fim</p>")).toBe("**tudo _junto_** fim");
    expect(htmlToMarkdown("<p><b></b>vazio</p>")).toBe("vazio");
  });

  it("turns typed punctuation into text, not formatting", () => {
    const typed = ["2 * 3 = 6 e a_b_c", "# não é título", "- não é lista", "1. não é lista", "---", "[x] não é caixa", "\\caminho", "`crase`"];
    for (const text of typed) {
      const md = htmlToMarkdown(`<p>${text}</p>`);
      expect(plainText(md), text).toBe(text);
      expect(shape(md).map((b) => b.kind), text).toEqual(["paragraph"]);
    }
  });

  it("drops what it does not support but keeps the words", () => {
    expect(htmlToMarkdown('<p>a <u>sub</u> <s>riscado</s> <mention indicator="@" text="Ana">@Ana</mention></p><img src="x.png"/>')).toBe("a sub riscado @Ana");
    expect(htmlToMarkdown("<blockquote><p>citação</p></blockquote>")).toBe("citação");
    expect(htmlToMarkdown('<p><a href="javascript:alert(1)">clique</a></p>')).toBe("clique");
  });

  it("decodes entities and skips empty lines", () => {
    expect(htmlToMarkdown("<p>a &amp; b &lt;c&gt; &quot;d&quot; &#233; &#x2713;</p><br><p></p><p>fim</p>")).toBe('a & b <c> "d" é ✓\n\nfim');
  });

  it("keeps each line of the editor as its own paragraph", () => {
    expect(htmlToMarkdown("<p>primeira</p><p>segunda</p>")).toBe("primeira\n\nsegunda");
  });

  it("writes code blocks as fences", () => {
    expect(htmlToMarkdown("<codeblock><p>x = 1</p><p>y = 2</p></codeblock>")).toBe("```\nx = 1\ny = 2\n```");
  });

  it("accepts the web editor's checkbox items with an inner paragraph", () => {
    expect(htmlToMarkdown('<ul data-type="checkbox"><li checked><p>feito</p></li><li><p>falta</p></li></ul>')).toBe("- [x] feito\n- [ ] falta");
  });
});

describe("round trip", () => {
  const samples = [
    "Precisamos de:\n\n- [ ] caixa de som\n- [x] microfone\n- [ ] extensão de **10 m**",
    "# Plano\n\nLevar _tudo_ cedo.\n\n1. montar\n2. testar",
    "Mapa: [Praça do Derby](https://example.org/derby) e https://example.org/x",
    "**Atenção:** levar `cabo` e _fita_",
    "```\nlinha 1\nlinha 2\n```",
    "Texto com \\*asterisco\\* e \\# no meio",
    "Endereço solto: https://example.org/a_b*c no texto",
  ];
  for (const md of samples) {
    it(`keeps ${JSON.stringify(md.slice(0, 30))}`, () => {
      expect(shape(roundTrip(md))).toEqual(shape(md));
      // And it settles: a second pass changes nothing.
      expect(roundTrip(roundTrip(md))).toBe(roundTrip(md));
    });
  }
});

describe("typed links", () => {
  it("adds https and refuses anything that is not a web address", () => {
    expect(safeLink(" exemplo.org/mapa ")).toBe("https://exemplo.org/mapa");
    expect(safeLink("http://exemplo.org")).toBe("http://exemplo.org");
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("mailto:a@b.org")).toBeNull();
    expect(safeLink("só texto")).toBeNull();
    expect(safeLink("")).toBeNull();
  });
});
