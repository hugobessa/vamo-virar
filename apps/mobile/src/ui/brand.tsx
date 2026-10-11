// Brand pieces taken from the campaign identity: sheared colour boxes with a
// visible "depth" edge, heavy upper-case type, a star, and the flag's colours
// as small details. All built from plain Views and Text so they render on
// native and on the web (Storybook) alike.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Text, View, type ViewStyle } from "react-native";
import { fonts, motion, palette, shear, useReducedMotion, useTheme } from "./theme";

/**
 * A burst of brand stars flying out from a point, for the moment someone
 * confirms they are going. Fires each time `trigger` changes to a new
 * positive value; renders nothing between bursts and under reduced motion.
 */
export function StarBurst({ trigger, color = palette.red }: { trigger: number; color?: string }) {
  const reduced = useReducedMotion();
  const [live, setLive] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!trigger || reduced) return;
    setLive(true);
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: motion.story + 200, easing: motion.easing.out, useNativeDriver: true }).start(() => setLive(false));
  }, [trigger, reduced, progress]);
  if (!live) return null;
  const stars = Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const reach = 56 + (i % 3) * 14;
    return (
      <Animated.Text
        key={i}
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          position: "absolute",
          color,
          fontSize: 18 + (i % 2) * 6,
          opacity: progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * reach] }) },
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * reach - 24] }) },
            { scale: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 1.2, 0.6] }) },
            { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${(i % 2 ? 1 : -1) * 120}deg`] }) },
          ],
        }}
      >
        ★
      </Animated.Text>
    );
  });
  return (
    <View pointerEvents="none" style={{ height: 0, alignItems: "center", overflow: "visible", zIndex: 10 }}>
      {stars}
    </View>
  );
}

export type BoxTone = "red" | "green" | "yellow" | "blue" | "white";

// Text on green and yellow is ink, not white: white on the brand green is
// 2.6:1, below the 3:1 floor for large type.
const boxes: Record<BoxTone, { fill: string; depth: string; ink: string }> = {
  red: { fill: palette.red, depth: palette.redDark, ink: palette.white },
  green: { fill: palette.green, depth: palette.greenDark, ink: palette.ink },
  yellow: { fill: palette.yellow, depth: "#C9A600", ink: palette.ink },
  blue: { fill: palette.blue, depth: "#001F7D", ink: palette.white },
  white: { fill: palette.offWhite, depth: "#CFCBD0", ink: palette.red },
};

const boxSizes = {
  sm: { font: 14, padX: 10, padY: 5, depth: 3 },
  md: { font: 24, padX: 16, padY: 8, depth: 5 },
  lg: { font: 44, padX: 24, padY: 12, depth: 8 },
  xl: { font: 72, padX: 32, padY: 16, depth: 12 },
};
export type BoxSize = keyof typeof boxSizes;

/**
 * A colour box with a darker depth edge. Sheared by default; pass
 * `skewed={false}` when a parent (like `Wordmark`) shears the whole group so
 * the edges of neighbouring boxes stay parallel.
 */
export function BrandBox({
  tone = "red",
  size = "md",
  skewed = true,
  children,
  style,
}: {
  tone?: BoxTone;
  size?: BoxSize;
  skewed?: boolean;
  /** A string is set in the display face; pass nodes for custom content. */
  children: ReactNode;
  style?: ViewStyle;
}) {
  const b = boxes[tone];
  const s = boxSizes[size];
  return (
    <View
      style={[
        { alignSelf: "flex-start", marginLeft: s.depth, marginBottom: s.depth },
        skewed ? { transform: [{ skewY: shear }] } : null,
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={{ position: "absolute", top: s.depth, left: -s.depth, right: s.depth, bottom: -s.depth, backgroundColor: b.depth }}
      />
      <View style={{ backgroundColor: b.fill, paddingHorizontal: s.padX, paddingVertical: s.padY }}>
        {typeof children === "string" ? (
          <Text
            style={{
              color: b.ink,
              fontFamily: fonts.display,
              fontSize: s.font,
              lineHeight: s.font * 1.05,
              fontWeight: "900",
              textTransform: "uppercase",
              letterSpacing: -s.font * 0.02,
            }}
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

export function Star({ size = 24, color = palette.red }: { size?: number; color?: string }) {
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color, fontSize: size, lineHeight: size * 1.1 }}>
      ★
    </Text>
  );
}

/** Small Brazilian flag drawn with Views (10:7 like the real one). */
export function Flag({ width = 40 }: { width?: number }) {
  const height = width * 0.7;
  const diamond = width * 0.56;
  const disc = width * 0.3;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Bandeira do Brasil"
      style={{ width, height, backgroundColor: palette.green, alignItems: "center", justifyContent: "center", overflow: "hidden" }}
    >
      <View style={{ width: diamond, height: diamond, backgroundColor: palette.yellow, transform: [{ scaleY: 0.72 }, { rotate: "45deg" }] }} />
      <View style={{ position: "absolute", width: disc, height: disc, borderRadius: disc, backgroundColor: palette.blue, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: disc * 1.4, height: Math.max(1, disc * 0.1), backgroundColor: palette.white, transform: [{ rotate: "-14deg" }] }} />
      </View>
    </View>
  );
}

/** Three-colour rule (green, yellow, blue): the flag as a detail, not a banner. */
export function FlagStripe({ height = 6, width }: { height?: number; width?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ flexDirection: "row", height, width, alignSelf: width ? "flex-start" : "stretch" }}>
      <View style={{ flex: 1, backgroundColor: palette.green }} />
      <View style={{ flex: 1, backgroundColor: palette.yellow }} />
      <View style={{ flex: 1, backgroundColor: palette.blue }} />
    </View>
  );
}

const wordmarkScale = { sm: 0.5, md: 0.75, lg: 1, xl: 1.5 };

/**
 * The app's lockup: VAMO / VIRAR in a red cube, a blue tag and a flag box. The
 * whole group is sheared as one piece, like the campaign cube logo.
 */
export function Wordmark({ size = "md", tagline = "Comunidade" }: { size?: keyof typeof wordmarkScale; tagline?: string }) {
  const k = wordmarkScale[size];
  const f = 46 * k; // font size of the two words
  const depth = 8 * k;
  const w = f * 3.5 + 36 * k; // approximate width of "VIRAR" plus padding
  const lift = Math.round(w * 0.11); // room for the shear: tan(11.3°) ≈ 0.2, half each way
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Vamo Virar, ${tagline}`}
      style={{ width: w + depth * 2, paddingVertical: lift + depth, paddingLeft: depth, alignSelf: "flex-start" }}
    >
      <View style={{ transform: [{ skewY: shear }], width: w }}>
        <View pointerEvents="none" style={{ position: "absolute", top: depth, left: -depth, right: depth, bottom: -depth - 14 * k, backgroundColor: palette.redDark }} />
        <View style={{ backgroundColor: palette.red, paddingHorizontal: 18 * k, paddingTop: 12 * k, paddingBottom: 22 * k }}>
          {["VAMO", "VIRAR"].map((word) => (
            <Text
              key={word}
              numberOfLines={1}
              style={{ color: palette.white, fontFamily: fonts.display, fontWeight: "900", fontSize: f, lineHeight: f * 1.0, letterSpacing: -2 * k }}
            >
              {word}
            </Text>
          ))}
          <View style={{ position: "absolute", top: 8 * k, right: 12 * k }}>
            <Star size={20 * k} color={palette.white} />
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: -14 * k, marginLeft: 22 * k, gap: 6 * k }}>
          <BrandBox tone="blue" size="sm" skewed={false}>
            {tagline}
          </BrandBox>
          <BrandBox tone="green" size="sm" skewed={false} style={{ marginLeft: 0 }}>
            <Flag width={26 * k + 8} />
          </BrandBox>
        </View>
      </View>
    </View>
  );
}

/** Upper-case heavy headline in the condensed face, optionally sheared. */
export function Display({
  children,
  tone = "text",
  size = "h1",
  skewed,
  align,
}: {
  children: ReactNode;
  tone?: "text" | "brand" | "onBrand" | "green";
  size?: "jumbo" | "display" | "h1" | "h2";
  skewed?: boolean;
  align?: "left" | "center";
}) {
  const c = useTheme();
  const color = tone === "brand" ? c.brand : tone === "onBrand" ? palette.white : tone === "green" ? c.greenDark : c.text;
  const sizes = { jumbo: [120, 108], display: [88, 80], h1: [56, 52], h2: [36, 36] } as const;
  const [fontSize, lineHeight] = sizes[size];
  // The shear drops the left end and lifts the right end of the box by
  // tan(11.3°) / 2 ≈ 0.1 of its width; leave room for both so the headline
  // never runs into what is above or below it, however wide it gets.
  const [width, setWidth] = useState(0);
  const lift = Math.max(fontSize * 0.25, width * 0.1 + 4);
  return (
    <Text
      accessibilityRole="header"
      onLayout={skewed ? (e) => setWidth(e.nativeEvent.layout.width) : undefined}
      style={[
        {
          color,
          fontFamily: fonts.condensed,
          fontSize,
          lineHeight,
          fontWeight: "900",
          textTransform: "uppercase",
          letterSpacing: -fontSize * 0.02,
          textAlign: align,
        },
        // Shrink-wrap the text so the shear (and the room it needs) follows the longest line.
        skewed ? { transform: [{ skewY: shear }], marginVertical: lift, alignSelf: align === "center" ? "center" : "flex-start", maxWidth: "100%" } : null,
      ]}
    >
      {children}
    </Text>
  );
}

/** Small spaced-out label above a section title. */
export function Eyebrow({ children, color }: { children: ReactNode; color?: string }) {
  const c = useTheme();
  return (
    <Text style={{ color: color ?? c.muted, fontFamily: fonts.display, fontSize: 12, fontWeight: "800", letterSpacing: 2.5, textTransform: "uppercase" }}>
      {children}
    </Text>
  );
}
