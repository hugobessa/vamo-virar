import { describe, expect, it } from "vitest";
import { palette, themes } from "./tokens";

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const isRed = (hex: string) => {
  const h = hue(hex);
  return h < 20 || h > 340;
};

function luminance(hex: string): number {
  const [r, g, b] = ([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("design tokens", () => {
  for (const mode of ["light", "dark"] as const) {
    const t = themes[mode];

    it(`${mode}: call-to-action colours are never red`, () => {
      expect(isRed(t.primary)).toBe(false);
      expect(isRed(t.accent)).toBe(false);
    });

    it(`${mode}: brand red is red and danger is distinct from the call-to-action colours`, () => {
      expect(isRed(t.brand)).toBe(true);
      expect(t.danger).not.toBe(t.primary);
      expect(t.danger).not.toBe(t.accent);
    });

    it(`${mode}: button labels meet 4.5:1`, () => {
      expect(contrast(t.primary, t.primaryText)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accent, t.accentText)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${mode}: body text and status text meet 4.5:1 on the background`, () => {
      for (const k of ["text", "muted", "ok", "warn", "danger"] as const) {
        expect(contrast(t.bg, t[k]), k).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("dark: white text on the red and blue bands meets 4.5:1, and the yellow band's text is readable", () => {
    const t = themes.dark;
    expect(contrast(t.bandRed, palette.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.bandBlue, palette.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.bandYellow, t.onBandYellow)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.bandYellow, t.bandNumber)).toBeGreaterThanOrEqual(4.5);
  });

  it("large white type on brand red stays above 3:1", () => {
    expect(contrast(palette.red, palette.white)).toBeGreaterThanOrEqual(3);
  });
});
