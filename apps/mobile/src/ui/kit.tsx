// Small UI kit: large touch targets, high contrast, readable type, and a
// little physical motion (buttons with a depth edge that collapses when
// pressed, a tab pill that slides, bars that fill). Every animation respects
// the system's reduced-motion setting through `useReducedMotion`.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { tap, type Tap } from "../lib/haptics";
import { BrandBox, FlagStripe } from "./brand";
import { fonts, motion, palette, radius, shear, space, touch, type, useReducedMotion, useTheme } from "./theme";

/**
 * True inside a community that an admin disabled (marked for deletion):
 * buttons and fields turn off, except buttons marked `allowReadOnly`
 * (navigation, showing and hiding things, re-enabling).
 */
export const ReadOnly = createContext(false);

export function Screen({ children, scroll = true, onRefresh }: { children: ReactNode; scroll?: boolean; onRefresh?: () => Promise<unknown> | void }) {
  const c = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const body = <View style={{ padding: space.l, gap: space.m }}>{children}</View>;
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
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["bottom", "left", "right"]}>
      <FlagStripe height={4} />
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" refreshControl={refresh}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: c.text, fontFamily: fonts.condensed, fontSize: 34, lineHeight: 36, fontWeight: "900", textTransform: "uppercase" }}>
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
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPressIn={() => press(true)}
      onPressOut={() => press(false)}
      onPress={() => {
        if (haptic) tap(haptic);
        onPress();
      }}
      style={{ paddingBottom: buttonDepth, opacity: flat ? 1 : off ? 0.5 : 1 }}
    >
      <View pointerEvents="none" style={[styles.depth, { backgroundColor: depth }]} />
      <Animated.View style={[styles.button, { backgroundColor: bg, borderColor: edge, transform: [{ translateY: sink }] }]}>
        {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontFamily: fonts.text, fontSize: 17, fontWeight: "700" }}>{label}</Text>}
      </Animated.View>
    </Pressable>
  );
}

/**
 * The look of a button without press handling, for links that must be real
 * anchors. The landing page's stylesheet sinks the face while the anchor is
 * active (see landing/motion.css).
 */
export function ButtonFace({ label, kind = "primary" }: { label: string; kind?: ButtonKind }) {
  const c = useTheme();
  const { bg, fg, edge, depth } = buttonColours(kind, c);
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
  const style = [styles.card, { backgroundColor: c.surface, borderColor: c.border }, accent ? { borderLeftWidth: 6, borderLeftColor: c.brand } : null];
  return onPress ? (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [...style, { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
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

/** Tabs with a pill that slides to the selected option. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const c = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const x = useRef(new Animated.Value(0)).current;
  const slot = width > 0 ? (width - 8) / options.length : 0;
  useEffect(() => {
    Animated.timing(x, { toValue: index * slot, duration: reduced ? 0 : motion.base, easing: motion.easing.out, useNativeDriver: true }).start();
  }, [index, slot, reduced, x]);
  return (
    <View accessibilityRole="tablist" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: "row", backgroundColor: c.surface, borderRadius: radius, padding: 4 }}>
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
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: touch - 8, alignItems: "center", justifyContent: "center", borderRadius: radius - 4 }}
          >
            <Text style={{ color: c.text, fontWeight: on ? "700" : "500", fontSize: 16 }}>{o.label}</Text>
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
export function EmptyState({ title, body, action, onAction, testID }: { title: string; body?: string; action?: string; onAction?: () => void; testID?: string }) {
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
      {action && onAction ? <Button label={action} onPress={onAction} /> : null}
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

const styles = StyleSheet.create({
  button: { minHeight: touch, borderRadius: radius, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.l },
  depth: { position: "absolute", left: 0, right: 0, top: buttonDepth, bottom: 0, borderRadius: radius },
  input: { minHeight: touch, borderRadius: radius, borderWidth: 1, paddingHorizontal: space.m, fontSize: 17 },
  card: { borderRadius: radius, borderWidth: 1, padding: space.l, gap: space.s },
});
