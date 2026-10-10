import { createContext, useContext } from "react";
import { Platform, useColorScheme } from "react-native";
import { themes, type Theme } from "./tokens";

export { palette, themes, type Theme } from "./tokens";

/** Forces a colour scheme for a subtree (Storybook, screenshots); `null` follows the system. */
export const SchemeOverride = createContext<"light" | "dark" | null>(null);

export function useTheme(): Theme {
  const forced = useContext(SchemeOverride);
  const system = useColorScheme();
  return (forced ?? system) === "dark" ? themes.dark : themes.light;
}

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 40, huge: 72 };
export const radius = 12;
/** Minimum touch target (accessibility). */
export const touch = 48;
/** Shear applied to brand boxes and display type (guide: -11.3°). */
export const shear = "-11.3deg";

/**
 * Typefaces. The guide asks for Transducer (Condensed Black for headlines,
 * Extended Black for the wordmark and subtitles) and Gotham (running text),
 * all licensed Adobe Fonts. Barlow Condensed, Archivo and Montserrat are open
 * stand-ins; swap the names here once the licences are in. Native falls back
 * to the system font until the fonts are bundled with the app.
 */
export const fonts = {
  /** Headlines: heavy and condensed, upper case, tight tracking. */
  condensed: Platform.select({ web: '"Barlow Condensed", "Arial Narrow", Impact, sans-serif', default: undefined }),
  /** Wordmark and subtitles: heavy and wide. */
  display: Platform.select({ web: '"Archivo", "Arial Black", sans-serif', default: undefined }),
  /** Running text and UI labels. */
  text: Platform.select({ web: '"Montserrat", system-ui, -apple-system, "Segoe UI", sans-serif', default: undefined }),
};

export const type = {
  display: { fontSize: 72, lineHeight: 66, fontWeight: "900" as const, letterSpacing: -1 },
  h1: { fontSize: 48, lineHeight: 46, fontWeight: "900" as const, letterSpacing: -0.5 },
  h2: { fontSize: 32, lineHeight: 32, fontWeight: "900" as const, letterSpacing: -0.25 },
  h3: { fontSize: 20, lineHeight: 26, fontWeight: "700" as const, letterSpacing: 0 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: "600" as const },
  small: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const },
  eyebrow: { fontSize: 13, lineHeight: 16, fontWeight: "700" as const, letterSpacing: 2 },
};
