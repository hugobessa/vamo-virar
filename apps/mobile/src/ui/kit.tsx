// Small UI kit: large touch targets, high contrast, readable type.

import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlagStripe } from "./brand";
import { fonts, radius, space, touch, type, useTheme } from "./theme";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const c = useTheme();
  const body = <View style={{ padding: space.l, gap: space.m }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["bottom", "left", "right"]}>
      <FlagStripe height={4} />
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
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

export function Button({
  label,
  onPress,
  kind = "primary",
  busy,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  const off = disabled || busy;
  // A disabled filled button turns flat grey: clearer than a faded blue.
  const flat = disabled && (kind === "primary" || kind === "accent");
  const bg = flat ? c.surface : kind === "primary" ? c.primary : kind === "accent" ? c.accent : "transparent";
  const fg = flat ? c.muted : kind === "primary" ? c.primaryText : kind === "accent" ? c.accentText : kind === "danger" ? c.danger : c.text;
  const edge = flat ? c.border : kind === "primary" || kind === "accent" ? bg : kind === "danger" ? c.danger : c.border;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: edge, opacity: flat ? 1 : off ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontFamily: fonts.text, fontSize: 17, fontWeight: "700" }}>{label}</Text>}
    </Pressable>
  );
}

/** The look of a button without press handling, for links that must be real anchors. */
export function ButtonFace({ label, kind = "primary" }: { label: string; kind?: ButtonKind }) {
  const c = useTheme();
  const bg = kind === "primary" ? c.primary : kind === "accent" ? c.accent : "transparent";
  const fg = kind === "primary" ? c.primaryText : kind === "accent" ? c.accentText : kind === "danger" ? c.danger : c.text;
  const edge = kind === "primary" || kind === "accent" ? bg : kind === "danger" ? c.danger : c.border;
  return (
    <View style={[styles.button, { backgroundColor: bg, borderColor: edge }]}>
      <Text style={{ color: fg, fontFamily: fonts.text, fontSize: 17, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

export function Field({ label, help, error, onFocus, onBlur, ...props }: TextInputProps & { label: string; help?: string; error?: string }) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...props}
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
        <View style={{ width: 6, height: 22, backgroundColor: c.brand, transform: [{ skewY: "-11.3deg" }] }} />
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
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [...style, { opacity: pressed ? 0.85 : 1 }]}>
      {children}
    </Pressable>
  ) : (
    <View testID={testID} style={style}>
      {children}
    </View>
  );
}

export function Chip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const c = useTheme();
  const fg = tone === "ok" ? c.ok : tone === "warn" ? c.warn : tone === "danger" ? c.danger : c.text;
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: c.chip, borderRadius: 999, paddingHorizontal: space.m, paddingVertical: space.xs }}>
      <Text style={{ color: fg, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const c = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: c.surface, borderRadius: radius, padding: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: touch - 8, alignItems: "center", justifyContent: "center", borderRadius: radius - 4, backgroundColor: on ? c.bg : "transparent" }}
          >
            <Text style={{ color: c.text, fontWeight: on ? "700" : "500", fontSize: 16 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Banner({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "warn" | "danger" | "ok" }) {
  const c = useTheme();
  const fg = tone === "warn" ? c.warn : tone === "danger" ? c.danger : tone === "ok" ? c.ok : c.muted;
  return (
    <View accessibilityLiveRegion="polite" style={{ borderLeftWidth: 4, borderLeftColor: fg, paddingLeft: space.m, paddingVertical: space.xs }}>
      <Text style={{ color: fg, fontSize: 15 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: touch, borderRadius: radius, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.l },
  input: { minHeight: touch, borderRadius: radius, borderWidth: 1, paddingHorizontal: space.m, fontSize: 17 },
  card: { borderRadius: radius, borderWidth: 1, padding: space.l, gap: space.s },
});
