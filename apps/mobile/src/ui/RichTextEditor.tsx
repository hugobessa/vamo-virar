// The task description editor: what you see is what you get, no Markdown in
// sight. A native text field on iOS and Android (react-native-enriched-html),
// a contenteditable on web; never a WebView.

import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { EnrichedTextInput, type EnrichedTextInputInstance, type OnChangeStateEvent } from "react-native-enriched-html";
import { markdownToHtml } from "../model/richtext";
import { fonts, radius, space, touch, useTheme } from "./theme";

type Tool = { key: string; label: string; a11y: string; style?: object; active: (s: OnChangeStateEvent | null) => boolean; run: (e: EnrichedTextInputInstance) => void };

const TOOLS: Tool[] = [
  { key: "bold", label: "N", a11y: "Negrito", style: { fontWeight: "900" }, active: (s) => !!s?.bold.isActive, run: (e) => e.toggleBold() },
  { key: "italic", label: "I", a11y: "Itálico", style: { fontStyle: "italic", fontWeight: "700" }, active: (s) => !!s?.italic.isActive, run: (e) => e.toggleItalic() },
  { key: "list", label: "• Lista", a11y: "Lista", active: (s) => !!s?.unorderedList.isActive, run: (e) => e.toggleUnorderedList() },
  { key: "check", label: "☑ Checklist", a11y: "Checklist", active: (s) => !!s?.checkboxList.isActive, run: (e) => e.toggleCheckboxList(false) },
];

export function RichTextEditor({ label, markdown, placeholder, testID }: { label: string; markdown: string; placeholder?: string; testID?: string }) {
  const c = useTheme();
  const ref = useRef<EnrichedTextInputInstance>(null);
  const [state, setState] = useState<OnChangeStateEvent | null>(null);
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      <View style={{ borderRadius: radius, borderWidth: focused ? 2 : 1, borderColor: focused ? c.primary : c.border, backgroundColor: c.bg, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, padding: space.xs, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surface }}>
          {TOOLS.map((tool) => {
            const on = tool.active(state);
            return (
              <Pressable
                key={tool.key}
                testID={testID ? `${testID}-${tool.key}` : undefined}
                accessibilityRole="button"
                accessibilityLabel={tool.a11y}
                accessibilityState={{ selected: on }}
                onPress={() => ref.current && tool.run(ref.current)}
                style={({ pressed }) => ({ minHeight: touch - 12, minWidth: touch - 12, paddingHorizontal: space.s, alignItems: "center", justifyContent: "center", borderRadius: radius - 4, backgroundColor: on ? c.primary : pressed ? c.chip : "transparent" })}
              >
                <Text style={[{ color: on ? c.primaryText : c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "600" }, tool.style]}>{tool.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <EnrichedTextInput
          ref={ref}
          testID={testID}
          defaultValue={markdownToHtml(markdown)}
          placeholder={placeholder}
          placeholderTextColor={c.muted}
          onChangeState={(e) => setState(e.nativeEvent)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          htmlStyle={{ a: { color: c.primary, textDecorationLine: "underline" }, ul: { bulletColor: c.text }, ulCheckbox: { boxColor: c.primary } }}
          style={{ minHeight: touch * 3, padding: space.m, fontSize: 17, color: c.text, fontFamily: fonts.text }}
        />
      </View>
    </View>
  );
}
