// Colour tokens (no React Native imports, so the unit tests can read them). Palette values come from the Lula 2026 campaign branding guide.
//
// Rule: brand red is an identity colour (headers, big type, decoration). It is
// also the colour people read as "danger", so it is never the fill of a primary
// or accent call to action. CTAs use blue (primary) and yellow (accent).

/** Raw brand palette (light-surface values). Prefer `useTheme()` in components. */
export const palette = {
  redDark: "#A20301",
  red: "#FD0000",
  yellow: "#FFD400",
  green: "#00B923",
  greenDark: "#006820",
  blue: "#0034D2",
  offWhite: "#F3F2F3",
  white: "#FFFFFF",
  cream: "#F6EFE7",
  purpleDark: "#320D59",
  purple: "#A237FB",
  ink: "#141414",
} as const;

const light = {
  bg: palette.white,
  surface: palette.offWhite,
  cream: palette.cream,
  text: palette.ink,
  muted: "#55555E",
  border: "#DDDADC",
  /** Primary CTA. Blue, never red. */
  primary: palette.blue,
  primaryText: palette.white,
  /** Secondary CTA for use on brand-coloured or dark surfaces. */
  accent: palette.yellow,
  accentText: palette.ink,
  /** Identity red: large type, boxes, decoration. Not for CTAs. */
  brand: palette.red,
  brandDark: palette.redDark,
  brandText: palette.white,
  green: palette.green,
  greenDark: palette.greenDark,
  ok: palette.greenDark,
  warn: "#8A5A00",
  /** Error and destructive actions: the dark red, always paired with a label or icon. */
  danger: palette.redDark,
  chip: "#ECE7F5",
  focus: palette.purple,
  // Full-bleed bands on the landing page. Bright in light mode; in dark mode
  // they are deep tints so they don't glare against the page.
  bandRed: palette.red,
  bandBlue: palette.blue,
  bandYellow: palette.yellow,
  onBandYellow: palette.ink,
  /** Big step numbers on the yellow band. */
  bandNumber: palette.greenDark,
  /** Outline of device mockups. */
  frame: palette.ink,
  /** Depth edge under a primary button; it collapses when pressed. */
  primaryDepth: "#001F7D",
  /** Depth edge under an accent button. */
  accentDepth: "#C9A600",
};

export type Theme = { [K in keyof typeof light]: string };

const dark: Theme = {
  bg: "#0E0E12",
  surface: "#1A1A20",
  cream: "#15151A",
  text: "#F3F2F3",
  muted: "#A9A9B3",
  border: "#33333B",
  primary: "#7D9BFF",
  primaryText: "#0A1233",
  accent: palette.yellow,
  accentText: palette.ink,
  brand: "#FF3B3B",
  brandDark: "#FF8A80",
  brandText: palette.white,
  green: "#3DD65C",
  greenDark: "#6FD394",
  ok: "#6FD394",
  warn: "#F0C062",
  danger: "#FF8A80",
  chip: "#2B2638",
  focus: "#C58BFF",
  bandRed: "#7A0200",
  bandBlue: "#0B1F73",
  bandYellow: "#1A1A20",
  onBandYellow: "#F3F2F3",
  bandNumber: palette.yellow,
  frame: "#3A3A45",
  primaryDepth: "#4E6BC9",
  accentDepth: "#C9A600",
};

export const themes = { light, dark } as const;
