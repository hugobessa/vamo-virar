// The bottom bar of a community: its four sections, drawn in the app's own
// style (a short brand-coloured mark over the open section, counts beside the
// labels). The tabs layout feeds it from the navigator; Storybook draws it
// under a screen from the scenario.

import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CountBadge } from "../kit";
import { fonts, shear, space, touch, useTheme } from "../theme";

export type TabKey = "index" | "tasks" | "people" | "me";
export const TAB_KEYS: readonly TabKey[] = ["index", "tasks", "people", "me"];

export interface TabItem {
  key: TabKey;
  label: string;
  badge?: number;
  active: boolean;
  testID?: string;
}

export function TabBar({ items, onPress }: { items: TabItem[]; onPress: (key: TabKey) => void }) {
  const c = useTheme();
  return (
    <SafeAreaView edges={["bottom"]} style={{ backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border }}>
      <View accessibilityRole="tablist" style={{ flexDirection: "row" }}>
        {items.map((it) => (
          <Pressable
            key={it.key}
            testID={it.testID}
            accessibilityRole="tab"
            accessibilityLabel={it.badge ? `${it.label} (${it.badge})` : it.label}
            accessibilityState={{ selected: it.active }}
            onPress={() => onPress(it.key)}
            style={({ pressed }) => ({ flex: 1, minHeight: touch + 8, alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: space.s, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ width: 22, height: 4, backgroundColor: it.active ? c.brand : "transparent", transform: [{ skewX: shear }] }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: it.active ? c.text : c.muted, fontFamily: fonts.text, fontSize: 13, fontWeight: it.active ? "800" : "600" }}>{it.label}</Text>
              {it.badge ? <CountBadge n={it.badge} /> : null}
            </View>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
