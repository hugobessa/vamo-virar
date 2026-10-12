// Tiny HTML helpers. Every value interpolated into a page goes through `esc`
// (or `html`, which escapes for you).

export function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Already-safe markup, passed through `html` untouched. */
export class Safe {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

export const raw = (s: string) => new Safe(s);

type Part = Safe | string | number | null | undefined | false | Part[];

function render(v: Part): string {
  if (v === null || v === undefined || v === false) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  if (v instanceof Safe) return v.value;
  return esc(v);
}

/** Tagged template that escapes every interpolation except `Safe` values. */
export function html(strings: TemplateStringsArray, ...values: Part[]): Safe {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? "");
  });
  return new Safe(out);
}

export function megabytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB` : `${Math.round(mb)} MB`;
}
