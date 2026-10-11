// Renders the Markdown subset of model/markdown with the app's own text styles.

import { Fragment, type ReactNode } from "react";
import { Linking, Text, View } from "react-native";
import { parseMarkdown, type Block, type Inline } from "../model/markdown";
import { fonts, radius, space, type, useTheme } from "./theme";

export function Markdown({ source, muted, testID }: { source: string; muted?: boolean; testID?: string }) {
  const c = useTheme();
  const color = muted ? c.muted : c.text;
  const blocks = parseMarkdown(source);
  return (
    <View testID={testID} style={{ gap: space.s }}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} color={color} />
      ))}
    </View>
  );
}

function BlockView({ block, color }: { block: Block; color: string }) {
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
          {block.items.map((it, i) => (
            <View key={i} style={{ flexDirection: "row", gap: space.s }}>
              <Text style={[base, { width: 24, textAlign: "center", color: it.checked === undefined ? color : it.checked ? c.ok : c.muted }]}>
                {it.checked === undefined ? (block.ordered ? `${i + 1}.` : "•") : it.checked ? "☑" : "☐"}
              </Text>
              <Text style={[base, { flex: 1, textDecorationLine: it.checked ? "line-through" : "none", color: it.checked ? c.muted : color }]}>
                <Inlines nodes={it.children} color={color} />
              </Text>
            </View>
          ))}
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
