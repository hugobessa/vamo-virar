// Renders the Markdown subset of model/markdown with the app's own text styles.
// With `onToggle`, check boxes are real check boxes: tapping one reports its
// source line. Without it they are drawn as a quiet status, not as controls.

import { Fragment, useContext, type ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { parseMarkdown, type Block, type Inline, type ListItem } from "../model/markdown";
import { ReadOnly } from "./kit";
import { fonts, radius, space, touch, type, useTheme } from "./theme";

export function Markdown({ source, muted, testID, onToggle }: { source: string; muted?: boolean; testID?: string; onToggle?: (line: number) => void }) {
  const c = useTheme();
  const color = muted ? c.muted : c.text;
  const blocks = parseMarkdown(source);
  return (
    <View testID={testID} style={{ gap: space.s }}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} color={color} onToggle={onToggle} />
      ))}
    </View>
  );
}

/** A drawn box: filled with a tick when done. Interactive boxes are larger and outlined in blue. */
function CheckBox({ checked, live }: { checked: boolean; live: boolean }) {
  const c = useTheme();
  const size = live ? 22 : 16;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        borderWidth: 2,
        borderColor: checked ? c.ok : live ? c.primary : c.border,
        backgroundColor: checked ? c.ok : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {checked ? <Text style={{ color: "#fff", fontSize: size - 6, lineHeight: size - 4, fontWeight: "900" }}>✓</Text> : null}
    </View>
  );
}

function CheckItem({ item, base, color, onToggle }: { item: ListItem; base: object; color: string; onToggle?: (line: number) => void }) {
  const c = useTheme();
  const readOnly = useContext(ReadOnly);
  const checked = !!item.checked;
  const text = (
    <Text style={[base, { flex: 1, textDecorationLine: checked ? "line-through" : "none", color: checked ? c.muted : color }]}>
      <Inlines nodes={item.children} color={checked ? c.muted : color} />
    </Text>
  );
  if (!onToggle || item.line === undefined || readOnly) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
        <View style={{ width: 24, alignItems: "center" }}>
          <CheckBox checked={checked} live={false} />
        </View>
        {text}
      </View>
    );
  }
  const line = item.line;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onToggle(line)}
      style={({ pressed }) => ({ minHeight: touch - 8, flexDirection: "row", alignItems: "center", gap: space.s, borderRadius: radius, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ width: 24, alignItems: "center" }}>
        <CheckBox checked={checked} live />
      </View>
      {text}
    </Pressable>
  );
}

function BlockView({ block, color, onToggle }: { block: Block; color: string; onToggle?: (line: number) => void }) {
  const c = useTheme();
  const base = { color, fontFamily: fonts.text, ...type.body };
  switch (block.kind) {
    case "heading": {
      const size = block.level === 1 ? 22 : block.level === 2 ? 19 : 17;
      return (
        <Text accessibilityRole="header" style={{ color, fontFamily: fonts.text, fontSize: size, lineHeight: size + 6, fontWeight: "800", marginTop: space.xs }}>
          <Inlines nodes={block.children} color={color} />
        </Text>
      );
    }
    case "paragraph":
      return (
        <Text style={base}>
          <Inlines nodes={block.children} color={color} />
        </Text>
      );
    case "list":
      return (
        <View style={{ gap: space.xs }}>
          {block.items.map((it, i) =>
            it.checked !== undefined ? (
              <CheckItem key={i} item={it} base={base} color={color} onToggle={onToggle} />
            ) : (
              <View key={i} style={{ flexDirection: "row", gap: space.s }}>
                <Text style={[base, { width: 24, textAlign: "center", color }]}>{block.ordered ? `${i + 1}.` : "•"}</Text>
                <Text style={[base, { flex: 1 }]}>
                  <Inlines nodes={it.children} color={color} />
                </Text>
              </View>
            ),
          )}
        </View>
      );
    case "code":
      return (
        <View style={{ backgroundColor: c.surface, borderRadius: radius, padding: space.m }}>
          <Text style={{ color, fontFamily: "monospace", fontSize: 14, lineHeight: 20 }}>{block.text}</Text>
        </View>
      );
    case "rule":
      return <View style={{ height: 1, backgroundColor: c.border, marginVertical: space.xs }} />;
  }
}

function Inlines({ nodes, color }: { nodes: Inline[]; color: string }): ReactNode {
  const c = useTheme();
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return <Fragment key={i}>{n.text}</Fragment>;
      case "strong":
        return (
          <Text key={i} style={{ fontWeight: "700" }}>
            <Inlines nodes={n.children} color={color} />
          </Text>
        );
      case "em":
        return (
          <Text key={i} style={{ fontStyle: "italic" }}>
            <Inlines nodes={n.children} color={color} />
          </Text>
        );
      case "code":
        return (
          <Text key={i} style={{ fontFamily: "monospace", backgroundColor: c.surface }}>
            {n.text}
          </Text>
        );
      case "link":
        return (
          <Text key={i} accessibilityRole="link" style={{ color: c.primary, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(n.href)}>
            <Inlines nodes={n.children} color={c.primary} />
          </Text>
        );
    }
  });
}
