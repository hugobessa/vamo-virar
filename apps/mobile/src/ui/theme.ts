import { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, Easing, Platform, useColorScheme } from "react-native";
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
 * Motion tokens. Four durations and two easings cover the whole product:
 * `out` for things that move into place, `overshoot` for the "stamp" of a
 * brand box or a pressed button. The CSS strings are for the landing page
 * and Storybook; the `Easing` functions are for React Native's Animated.
 */
export const motion = {
  /** Hover, press, chip toggles. */
  fast: 120,
  /** Most transitions: a card appearing, a tab pill sliding. */
  base: 200,
  /** A section revealing, a banner sliding in. */
  slow: 320,
  /** One beat of a longer story (the phone demo, a counter filling). */
  story: 600,
  /** Gap between items that enter one after another. */
  stagger: 60,
  css: {
    out: "cubic-bezier(0.2, 0, 0, 1)",
    overshoot: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  },
  easing: {
    out: Easing.bezier(0.2, 0, 0, 1),
    overshoot: Easing.bezier(0.34, 1.56, 0.64, 1),
  },
};

/** Forces reduced motion for a subtree (Storybook); `null` follows the system. */
export const ReducedMotionOverride = createContext<boolean | null>(null);

/** True when the person asked the system for less motion: animations then jump to their end state. */
export function useReducedMotion(): boolean {
  const forced = useContext(ReducedMotionOverride);
  const [system, setSystem] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setSystem(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setSystem(!!v));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return forced ?? system;
}

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
