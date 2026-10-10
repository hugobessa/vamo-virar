// Small UI kit: large touch targets, high contrast, readable type.

import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fonts, radius, space, touch, type, useTheme } from "./theme";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const c = useTheme();
  const body = <View style={{ padding: space.l, gap: space.m }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["bottom", "left", "right"]}>
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
  const bg = kind === "primary" ? c.primary : kind === "accent" ? c.accent : "transparent";
  const fg = kind === "primary" ? c.primaryText : kind === "accent" ? c.accentText : kind === "danger" ? c.danger : c.text;
  const edge = kind === "primary" || kind === "accent" ? bg : kind === "danger" ? c.danger : c.border;
  const off = disabled || busy;
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
        { backgroundColor: bg, borderColor: edge, opacity: off ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontFamily: fonts.text, fontSize: 17, fontWeight: "700" }}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, help, error, ...props }: TextInputProps & { label: string; help?: string; error?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: c.text, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...props}
        style={[styles.input, { color: c.text, borderColor: error ? c.danger : c.border, backgroundColor: c.surface }]}
      />
      {error ? <Text style={{ color: c.danger }}>{error}</Text> : help ? <Text style={{ color: c.muted }}>{help}</Text> : null}
    </View>
  );
}

export function Card({ children, onPress, testID }: { children: ReactNode; onPress?: () => void; testID?: string }) {
  const c = useTheme();
  const style = [styles.card, { backgroundColor: c.surface, borderColor: c.border }];
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
