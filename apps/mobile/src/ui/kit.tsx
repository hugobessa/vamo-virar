// Small UI kit: large touch targets, high contrast, readable type, and a
// little physical motion (buttons with a depth edge that collapses when
// pressed, a tab pill that slides, bars that fill). Every animation respects
// the system's reduced-motion setting through `useReducedMotion`. Layout
// follows the room there is (see layout.ts): one column on a phone, a centred
// column with side-by-side pieces on anything wider.

import { Children, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, LayoutAnimation, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { tap, type Tap } from "../lib/haptics";
import { BrandBox, FlagStripe } from "./brand";
import { columns, useLayout } from "./layout";
import { fonts, motion, palette, radius, shear, space, touch, type, useReducedMotion, useTheme } from "./theme";

/**
 * True inside a community that an admin disabled (marked for deletion):
 * buttons and fields turn off, except buttons marked `allowReadOnly`
 * (navigation, showing and hiding things, re-enabling).
 */
export const ReadOnly = createContext(false);

/**
 * A screen's scrolling body. The content sits in a centred column: a reading
 * measure by default, or `width="board"` for lists and two-column screens.
 * On iOS the scroll view insets itself above the keyboard and keeps the
 * focused field in view (Android resizes the window instead).
 */
export function Screen({
  children,
  scroll = true,
  onRefresh,
  width = "reading",
  bottomInset = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => Promise<unknown> | void;
  width?: keyof typeof columns;
  /** False under a tab bar, which takes the bottom safe area itself. */
  bottomInset?: boolean;
}) {
  const c = useTheme();
  const l = useLayout();
  const [refreshing, setRefreshing] = useState(false);
  const body = (
    <View
      style={{
        width: "100%",
        maxWidth: columns[width],
        alignSelf: "center",
        paddingHorizontal: l.gutter,
        paddingTop: l.compact ? space.l : space.xl,
        paddingBottom: l.compact ? space.l : space.xxl,
        gap: space.m,
      }}
    >
      {children}
    </View>
  );
  // Pull to refresh in the flag's colours (Android cycles through them; iOS takes the first).
  const refresh = onRefresh ? (
    <RefreshControl
      refreshing={refreshing}
      colors={[palette.green, palette.yellow, palette.blue]}
      tintColor={palette.green}
      onRefresh={async () => {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }}
    />
  ) : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={bottomInset ? ["bottom", "left", "right"] : ["left", "right"]}>
      <FlagStripe height={4} />
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" refreshControl={refresh}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

/** `caps={false}` for titles people wrote themselves, which read better as typed. A little larger where there is room. */
export function Title({ children, caps = true }: { children: ReactNode; caps?: boolean }) {
  const c = useTheme();
  const l = useLayout();
  return (
    <Text
      accessibilityRole="header"
      style={
        caps
          ? { color: c.text, fontFamily: fonts.condensed, fontSize: l.compact ? 34 : 44, lineHeight: l.compact ? 36 : 46, fontWeight: "900", textTransform: "uppercase" }
          : { color: c.text, fontFamily: fonts.text, fontSize: l.compact ? 28 : 32, lineHeight: l.compact ? 34 : 38, fontWeight: "800", letterSpacing: -0.3 }
      }
    >
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: c.text, fontFamily: fonts.text, ...type.h3, marginTop: space.s }}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const c = useTheme();
  return <Text style={{ color: muted ? c.muted : c.text, fontFamily: fonts.text, ...type.body }}>{children}</Text>;
}

/**
 * Button kinds. There is deliberately no brand-red kind: red reads as "danger",
 * so calls to action are blue (`primary`) or yellow (`accent`, for brand-coloured
 * and dark surfaces). `danger` is outlined dark red, for destructive actions only.
 */
export type ButtonKind = "primary" | "accent" | "secondary" | "danger";

/** Height of the depth edge under a button. */
export const buttonDepth = 3;

function buttonColours(kind: ButtonKind, c: ReturnType<typeof useTheme>, flat = false) {
  const bg = flat ? c.surface : kind === "primary" ? c.primary : kind === "accent" ? c.accent : c.bg;
  const fg = flat ? c.muted : kind === "primary" ? c.primaryText : kind === "accent" ? c.accentText : kind === "danger" ? c.danger : c.text;
  const edge = flat ? c.border : kind === "primary" || kind === "accent" ? bg : kind === "danger" ? c.danger : c.border;
  const depth = flat ? c.border : kind === "primary" ? c.primaryDepth : kind === "accent" ? c.accentDepth : kind === "danger" ? c.danger : c.border;
  return { bg, fg, edge, depth };
}

export function Button({
  label,
  onPress,
  kind = "primary",
  busy,
  disabled: disabledProp,
  testID,
  allowReadOnly,
  haptic,
  compact,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  /** Stays on in a read-only (disabled) community. */
  allowReadOnly?: boolean;
  /** A short vibration when pressed (confirmations, approvals). */
  haptic?: Tap;
  /** Smaller, for secondary actions next to content; still a full touch target. */
  compact?: boolean;
}) {
  const c = useTheme();
  const reduced = useReducedMotion();
  const readOnly = useContext(ReadOnly) && !allowReadOnly;
  const disabled = disabledProp || readOnly;
  const off = disabled || busy;
  // A disabled filled button turns flat grey: clearer than a faded blue.
  const flat = disabled && (kind === "primary" || kind === "accent");
  const { bg, fg, edge, depth } = buttonColours(kind, c, flat);
  // The face sinks onto its depth edge while pressed.
  const sink = useRef(new Animated.Value(0)).current;
  const press = (down: boolean) =>
    Animated.timing(sink, { toValue: down ? buttonDepth : 0, duration: reduced ? 0 : motion.fast, easing: motion.easing.out, useNativeDriver: true }).start();
  // A pointer over the button (web, or a mouse on a tablet) lightens it a touch.
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPressIn={() => press(true)}
      onPressOut={() => press(false)}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onPress={() => {
        if (haptic) tap(haptic);
        onPress();
      }}
      style={{ paddingBottom: buttonDepth, opacity: flat ? 1 : off ? 0.5 : hover ? 0.9 : 1 }}
    >
      <View pointerEvents="none" style={[styles.depth, { backgroundColor: depth }]} />
      <Animated.View style={[styles.button, compact ? styles.compact : null, { backgroundColor: bg, borderColor: edge, transform: [{ translateY: sink }] }]}>
        {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontFamily: fonts.text, fontSize: compact ? 15 : 17, fontWeight: "700" }}>{label}</Text>}
      </Animated.View>
    </Pressable>
  );
}

/**
 * The look of a button without press handling, for links that must be real
 * anchors. The landing page's stylesheet sinks the face while the anchor is
 * active (see landing/motion.css).
 */
export function ButtonFace({ label, kind = "primary", flat = false }: { label: string; kind?: ButtonKind; flat?: boolean }) {
  const c = useTheme();
  const { bg, fg, edge, depth } = buttonColours(kind, c, flat);
  return (
    <View style={{ paddingBottom: buttonDepth }}>
      <View pointerEvents="none" style={[styles.depth, { backgroundColor: depth }]} />
      <View style={[styles.button, { backgroundColor: bg, borderColor: edge }]}>
        <Text style={{ color: fg, fontFamily: fonts.text, fontSize: 17, fontWeight: "700" }}>{label}</Text>
      </View>
    </View>
  );
}

export function Field({ label, help, error, onFocus, onBlur, ...props }: TextInputProps & { label: string; help?: string; error?: string }) {
  const c = useTheme();
  const readOnly = useContext(ReadOnly);
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...props}
        editable={!readOnly && props.editable !== false}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          { color: c.text, fontFamily: fonts.text, backgroundColor: c.bg },
          // Blue ring on focus; the error colour wins over it.
          { borderColor: error ? c.danger : focused ? c.primary : c.border, borderWidth: focused || error ? 2 : 1 },
          props.multiline ? { minHeight: touch * 2, paddingTop: space.m, textAlignVertical: "top" } : null,
        ]}
      />
      {error ? <Text style={{ color: c.danger, fontFamily: fonts.text }}>{error}</Text> : help ? <Text style={{ color: c.muted, fontFamily: fonts.text }}>{help}</Text> : null}
    </View>
  );
}

/** Titled group of fields: a short brand-coloured bar, then the title. */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.m, marginTop: space.s }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
        <View style={{ width: 6, height: 22, backgroundColor: c.brand, transform: [{ skewY: shear }] }} />
        <Text accessibilityRole="header" style={{ color: c.text, fontFamily: fonts.display, fontSize: 18, fontWeight: "900", letterSpacing: -0.3, textTransform: "uppercase" }}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** `accent` adds a brand-coloured edge on the left, for cards that open something. */
export function Card({ children, onPress, testID, accent }: { children: ReactNode; onPress?: () => void; testID?: string; accent?: boolean }) {
  const c = useTheme();
  // A card that opens something rises a little under the pointer.
  const [hover, setHover] = useState(false);
  const style = [styles.card, { backgroundColor: c.surface, borderColor: hover ? c.muted : c.border }, accent ? { borderLeftWidth: 6, borderLeftColor: c.brand } : null];
  return onPress ? (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => [...style, { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }, { translateY: hover && !pressed ? -2 : 0 }] }]}
    >
      {children}
    </Pressable>
  ) : (
    <View testID={testID} style={style}>
      {children}
    </View>
  );
}

export type ChipTone = "neutral" | "ok" | "warn" | "danger";

export function Chip({ label, tone = "neutral" }: { label: string; tone?: ChipTone }) {
  const c = useTheme();
  const fg = tone === "ok" ? c.ok : tone === "warn" ? c.warn : tone === "danger" ? c.danger : c.text;
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: c.chip, borderRadius: 999, paddingHorizontal: space.m, paddingVertical: space.xs }}>
      <Text style={{ color: fg, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

/** Width of one tab where the tab bar does not fill the column. */
const tabWidth = 148;

/**
 * Tabs with a pill that slides to the selected option. On a phone they share
 * the width; where there is room each tab has the same fixed width and the
 * bar hugs them, so it does not stretch across a wide column.
 * `badge` puts a count next to an option's label, for things waiting there.
 */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string; badge?: number }[]; value: T; onChange: (v: T) => void }) {
  const c = useTheme();
  const reduced = useReducedMotion();
  const l = useLayout();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const x = useRef(new Animated.Value(0)).current;
  const slot = l.compact ? (width > 0 ? (width - 8) / options.length : 0) : tabWidth;
  useEffect(() => {
    Animated.timing(x, { toValue: index * slot, duration: reduced ? 0 : motion.base, easing: motion.easing.out, useNativeDriver: true }).start();
  }, [index, slot, reduced, x]);
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flexDirection: "row", alignSelf: l.compact ? "stretch" : "flex-start", backgroundColor: c.surface, borderRadius: radius, padding: 4 }}
    >
      {slot > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", top: 4, bottom: 4, left: 4, width: slot, borderRadius: radius - 4, backgroundColor: c.bg, transform: [{ translateX: x }] }}
        />
      ) : null}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.badge ? `${o.label} (${o.badge})` : o.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[l.compact ? { flex: 1 } : { width: tabWidth }, { minHeight: touch - 8, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderRadius: radius - 4 }]}
          >
            {/* Four tabs across a phone leave little room for each: the labels shrink a size. */}
            <Text numberOfLines={1} style={{ color: c.text, fontWeight: on ? "700" : "500", fontSize: l.compact && options.length >= 4 ? 15 : 16 }}>
              {o.label}
            </Text>
            {o.badge ? <CountBadge n={o.badge} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Slides and fades its children in when mounted. */
export function Enter({ children, delay = 0, from = 8 }: { children: ReactNode; delay?: number; from?: number }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduced ? 0 : motion.slow, delay: reduced ? 0 : delay, easing: motion.easing.out, useNativeDriver: true }).start();
  }, [v, delay, reduced]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

export function Banner({ text, tone = "neutral", animated }: { text: string; tone?: "neutral" | "warn" | "danger" | "ok"; animated?: boolean }) {
  const c = useTheme();
  const fg = tone === "warn" ? c.warn : tone === "danger" ? c.danger : tone === "ok" ? c.ok : c.muted;
  const body = (
    <View accessibilityLiveRegion="polite" style={{ borderLeftWidth: 4, borderLeftColor: fg, paddingLeft: space.m, paddingVertical: space.xs }}>
      <Text style={{ color: fg, fontSize: 15 }}>{text}</Text>
    </View>
  );
  return animated ? <Enter from={-8}>{body}</Enter> : body;
}

/** A sheared bar that fills to `value / max` when it appears. */
export function Progress({ value, max, label, tone = "ok" }: { value: number; max: number; label?: string; tone?: "ok" | "warn" }) {
  const c = useTheme();
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(0)).current;
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  useEffect(() => {
    Animated.timing(fill, { toValue: ratio, duration: reduced ? 0 : motion.story, easing: motion.easing.out, useNativeDriver: false }).start();
  }, [fill, ratio, reduced]);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max, now: value }} accessibilityLabel={label} style={{ gap: space.xs }}>
      <View style={{ height: 10, backgroundColor: c.chip, transform: [{ skewX: shear }], overflow: "hidden", marginHorizontal: 2 }}>
        <Animated.View style={{ height: "100%", backgroundColor: tone === "ok" ? c.green : c.accent, width: fill.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
      </View>
      {label ? <Text style={{ color: c.muted, fontFamily: fonts.text, ...type.small }}>{label}</Text> : null}
    </View>
  );
}

/** A short confirmation that slides up and fades after a few seconds. */
export function useToast(): [ReactNode, (text: string) => void] {
  const c = useTheme();
  const reduced = useReducedMotion();
  const [text, setText] = useState<string | null>(null);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!text) return;
    Animated.timing(v, { toValue: 1, duration: reduced ? 0 : motion.slow, easing: motion.easing.overshoot, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(v, { toValue: 0, duration: reduced ? 0 : motion.base, useNativeDriver: true }).start(() => setText(null));
    }, 3500);
    return () => clearTimeout(t);
  }, [text, v, reduced]);
  const node = text ? (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        backgroundColor: c.text,
        borderRadius: radius,
        padding: space.m,
        borderLeftWidth: 6,
        borderLeftColor: c.green,
      }}
    >
      <Text style={{ color: c.bg, fontFamily: fonts.text, fontSize: 15, fontWeight: "600" }}>{text}</Text>
    </Animated.View>
  ) : null;
  return [node, setText];
}

/** An empty list, drawn with the brand's boxes instead of a lonely sentence. */
export function EmptyState({ title, body, action, onAction, testID, actionTestID }: { title: string; body?: string; action?: string; onAction?: () => void; testID?: string; actionTestID?: string }) {
  const c = useTheme();
  return (
    <View testID={testID} style={{ alignItems: "flex-start", gap: space.m, paddingVertical: space.l }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: space.s }}>
        {(["green", "yellow", "blue"] as const).map((tone, i) => (
          <Enter key={tone} delay={i * motion.stagger * 2}>
            <View style={{ paddingLeft: i * 14 }}>
              <BrandBox tone={tone} size="sm">
                <View style={{ width: 48 + i * 16, height: 10 }} />
              </BrandBox>
            </View>
          </Enter>
        ))}
      </View>
      <Text style={{ color: c.text, fontFamily: fonts.text, ...type.h3 }}>{title}</Text>
      {body ? <Body muted>{body}</Body> : null}
      {action && onAction ? <Button testID={actionTestID} label={action} onPress={onAction} /> : null}
    </View>
  );
}

/** A section that opens on tap; the chevron turns and the content fades in. */
export function Collapsible({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const c = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: reduced ? 0 : motion.base, easing: motion.easing.out, useNativeDriver: true }).start();
  }, [open, turn, reduced]);
  return (
    <View style={{ gap: space.m }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((v) => !v);
        }}
        style={{ minHeight: touch, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.m, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.m }}
      >
        <Text style={{ color: c.text, fontFamily: fonts.display, fontSize: 16, fontWeight: "900", textTransform: "uppercase", letterSpacing: -0.3 }}>{title}</Text>
        <Animated.Text aria-hidden style={{ color: c.primary, fontSize: 22, fontWeight: "900", transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] }) }] }}>
          +
        </Animated.Text>
      </Pressable>
      {open ? <Enter>{children}</Enter> : null}
    </View>
  );
}

/**
 * A strip of figures at the top of a board: each a number over its label,
 * sharing the width. `tone` colours a number that asks for attention; a zero
 * stays quiet whatever its tone.
 */
export function Stats({ items }: { items: { value: number; label: string; tone?: "warn" | "danger" | "ok"; testID?: string }[] }) {
  const c = useTheme();
  const l = useLayout();
  return (
    <View style={{ flexDirection: "row", gap: l.compact ? space.s : space.m }}>
      {items.map((it) => {
        const fg = it.value === 0 || !it.tone ? c.text : it.tone === "danger" ? c.danger : it.tone === "warn" ? c.warn : c.ok;
        return (
          <View
            key={it.label}
            testID={it.testID}
            accessibilityLabel={`${it.label}: ${it.value}`}
            style={{ flex: 1, minWidth: 0, borderRadius: radius, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingVertical: space.s, paddingHorizontal: l.compact ? space.s : space.m, gap: 2 }}
          >
            <Text style={{ color: fg, fontFamily: fonts.condensed, fontSize: 28, lineHeight: 30, fontWeight: "900" }}>{it.value}</Text>
            {/* On a phone the four tiles are narrow: the label keeps its case and loses its tracking to fit. */}
            <Text
              numberOfLines={1}
              style={
                l.compact
                  ? { color: c.muted, fontFamily: fonts.text, fontSize: 11, fontWeight: "700" }
                  : { color: c.muted, fontFamily: fonts.text, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 }
              }
            >
              {it.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The heading of a group on a board: small, spaced capitals, with the count after it. */
export function GroupHeading({ text, n, tone }: { text: string; n?: number; tone?: "brand" }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: tone === "brand" ? c.brand : c.muted, fontFamily: fonts.display, fontSize: 12, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" }}>
      {n === undefined ? text : `${text} · ${n}`}
    </Text>
  );
}

/** A small round count, in the brand colour. */
export function CountBadge({ n }: { n: number }) {
  const c = useTheme();
  return (
    <View aria-hidden style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: c.brand, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontFamily: fonts.text, fontSize: 12, fontWeight: "800" }}>{n > 99 ? "99+" : n}</Text>
    </View>
  );
}

/** A bell for the header, with how many notifications wait. */
export function BellButton({ count, label, onPress, testID }: { count: number; label: string; onPress: () => void; testID?: string }) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label} (${count})` : label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ minWidth: 40, height: 40, borderRadius: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 6, backgroundColor: pressed ? c.chip : "transparent" })}
    >
      <Text style={{ color: count ? c.brand : c.muted, fontSize: 20, lineHeight: 24 }}>{count ? "🔔" : "🔕"}</Text>
      {count ? <CountBadge n={count} /> : null}
    </Pressable>
  );
}

/** A round "⋯" button that opens more options. */
export function MoreButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? c.chip : "transparent" })}
    >
      <Text style={{ color: c.muted, fontSize: 22, fontWeight: "900", lineHeight: 24 }}>⋯</Text>
    </Pressable>
  );
}

/**
 * A panel over a dimmed screen. On a phone it slides up from the bottom; where
 * there is room it is a dialog in the middle of the window, with a close
 * button. Tapping outside closes it either way.
 */
export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; testID?: string }) {
  const c = useTheme();
  const readOnly = useContext(ReadOnly);
  const l = useLayout();
  const dialog = !l.compact;
  return (
    <Modal visible={visible} transparent animationType={dialog ? "fade" : "slide"} onRequestClose={onClose}>
      <View style={dialog ? { flex: 1, justifyContent: "center", alignItems: "center", padding: space.xl } : { flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Fechar" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.4)" }]} />
        <SafeAreaView
          edges={dialog ? [] : ["bottom"]}
          testID={testID}
          style={
            dialog
              ? { width: "100%", maxWidth: 520, maxHeight: "85%", backgroundColor: c.bg, borderRadius: radius * 2, borderWidth: 1, borderColor: c.border }
              : { backgroundColor: c.bg, borderTopLeftRadius: radius * 2, borderTopRightRadius: radius * 2, maxHeight: "85%" }
          }
        >
          {dialog ? null : <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, marginTop: space.s }} />}
          <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: dialog ? space.xl : space.l, gap: space.m }}>
            {title || dialog ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
                <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, ...type.h3 }}>{title}</Text>
                {dialog ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Fechar"
                    onPress={onClose}
                    hitSlop={8}
                    style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? c.chip : "transparent" })}
                  >
                    <Text style={{ color: c.muted, fontSize: 20, fontWeight: "900", lineHeight: 24 }}>✕</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <ReadOnly.Provider value={readOnly}>{children}</ReadOnly.Provider>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/**
 * Two columns where there is room (`main` wider, on the left), one column
 * otherwise, with `main` on top. Sheets and other modals do not belong in
 * either: put them after it.
 */
export function Columns({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  const l = useLayout();
  if (!l.wide) {
    return (
      <>
        {main}
        {aside}
      </>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xxl }}>
      <View style={{ flex: 3, minWidth: 0, gap: space.m }}>{main}</View>
      <View style={{ flex: 2, minWidth: 0, gap: space.m }}>{aside}</View>
    </View>
  );
}

/** Cards in `columns` columns of equal width; one column just lays them out in a row each. */
export function Grid({ children, columns: n }: { children: ReactNode; columns: number }) {
  const items = Children.toArray(children).filter(Boolean);
  if (n <= 1) return <>{items}</>;
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return (
    <View style={{ gap: space.m }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: "row", gap: space.m }}>
          {row.map((item, j) => (
            <View key={j} style={{ flex: 1, minWidth: 0 }}>
              {item}
            </View>
          ))}
          {Array.from({ length: n - row.length }, (_, j) => (
            <View key={`pad${j}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Buttons stacked on a phone, side by side (wrapping) where there is room. */
export function Actions({ children }: { children: ReactNode }) {
  const l = useLayout();
  return <View style={l.compact ? { gap: space.m } : { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space.m }}>{children}</View>;
}

/** One row of a menu inside a Sheet. `danger` rows are red. */
export function MenuItem({ label, onPress, danger, testID, allowReadOnly }: { label: string; onPress: () => void; danger?: boolean; testID?: string; allowReadOnly?: boolean }) {
  const c = useTheme();
  const off = useContext(ReadOnly) && !allowReadOnly;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: touch, justifyContent: "center", paddingHorizontal: space.m, borderRadius: radius, backgroundColor: pressed ? c.surface : "transparent", opacity: off ? 0.5 : 1 })}
    >
      <Text style={{ color: danger ? c.danger : c.text, fontFamily: fonts.text, fontSize: 17, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: touch, borderRadius: radius, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.l },
  compact: { minHeight: touch - 4, paddingHorizontal: space.m },
  depth: { position: "absolute", left: 0, right: 0, top: buttonDepth, bottom: 0, borderRadius: radius },
  input: { minHeight: touch, borderRadius: radius, borderWidth: 1, paddingHorizontal: space.m, fontSize: 17 },
  card: { borderRadius: radius, borderWidth: 1, padding: space.l, gap: space.s },
});
