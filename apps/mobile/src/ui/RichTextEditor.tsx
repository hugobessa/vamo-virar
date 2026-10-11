// The task description editor: what you see is what you get, with no Markdown
// in sight. A native text view on iOS and Android (react-native-enriched-html),
// a contenteditable on web; never a WebView. It reads and writes Markdown
// through model/richtext, so what is stored and synced does not change.

import { useContext, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type OnChangeSelectionEvent,
  type OnChangeStateEvent,
  type OnLinkDetected,
} from "react-native-enriched-html";
import { useApp } from "../lib/context";
import type { StringKey } from "../model/i18n";
import { htmlToMarkdown, markdownToHtml, safeLink } from "../model/richtext";
import { Banner, Button, Field, ReadOnly, Sheet } from "./kit";
import { fonts, radius, space, touch, useTheme } from "./theme";

interface Tool {
  key: string;
  label: string;
  a11y: StringKey;
  style?: object;
  active: (s: OnChangeStateEvent | null) => boolean;
  run: (e: EnrichedTextInputInstance) => void;
}

const TOOLS: Tool[] = [
  { key: "bold", label: "N", a11y: "richBold", style: { fontWeight: "900" }, active: (s) => !!s?.bold.isActive, run: (e) => e.toggleBold() },
  { key: "italic", label: "I", a11y: "richItalic", style: { fontStyle: "italic", fontWeight: "700" }, active: (s) => !!s?.italic.isActive, run: (e) => e.toggleItalic() },
  { key: "list", label: "• Lista", a11y: "richList", active: (s) => !!s?.unorderedList.isActive, run: (e) => e.toggleUnorderedList() },
  { key: "check", label: "☑ Checklist", a11y: "richChecklist", active: (s) => !!s?.checkboxList.isActive, run: (e) => e.toggleCheckboxList(false) },
];

export function RichTextEditor({
  label,
  value,
  onChange,
  placeholder,
  testID,
}: {
  label: string;
  /** Markdown to start from. Later changes to it are ignored: the editor owns its text. */
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  testID?: string;
}) {
  const { t } = useApp();
  const c = useTheme();
  const readOnly = useContext(ReadOnly);
  const ref = useRef<EnrichedTextInputInstance>(null);
  const [initial] = useState(() => markdownToHtml(value));
  const [state, setState] = useState<OnChangeStateEvent | null>(null);
  const [focused, setFocused] = useState(false);
  const selection = useRef<OnChangeSelectionEvent>({ start: 0, end: 0, text: "" });
  const link = useRef<OnLinkDetected | null>(null);
  // The link sheet: what it would link, and the address being typed.
  const [linking, setLinking] = useState<{ start: number; end: number; editing: boolean } | null>(null);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState(false);

  const openLink = () => {
    const current = state?.link.isActive ? link.current : null;
    const sel = selection.current;
    setLinkError(false);
    if (current) {
      setLinking({ start: current.start, end: current.end, editing: true });
      setLinkText(current.text);
      setLinkUrl(current.url);
    } else {
      setLinking({ start: sel.start, end: sel.end, editing: false });
      setLinkText(sel.text);
      setLinkUrl("");
    }
  };
  const saveLink = () => {
    const url = safeLink(linkUrl);
    if (!url || !linking || !ref.current) return setLinkError(true);
    const text = linkText.trim() || url;
    ref.current.setLink(linking.start, linking.end, text, url);
    setLinking(null);
  };
  const removeLink = () => {
    if (linking && ref.current) ref.current.removeLink(linking.start, linking.end);
    setLinking(null);
  };

  const button = (key: string, text: string, a11y: string, on: boolean, onPress: () => void, style?: object) => (
    <Pressable
      key={key}
      testID={testID ? `${testID}-${key}` : undefined}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: on, disabled: readOnly }}
      disabled={readOnly}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touch - 12,
        minWidth: touch - 12,
        paddingHorizontal: space.s,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius - 4,
        backgroundColor: on ? c.primary : pressed ? c.chip : "transparent",
        opacity: readOnly ? 0.5 : 1,
      })}
    >
      <Text style={[{ color: on ? c.primaryText : c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "600" }, style]}>{text}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      <View style={{ borderRadius: radius, borderWidth: focused ? 2 : 1, borderColor: focused ? c.primary : c.border, backgroundColor: c.bg, overflow: "hidden" }}>
        <View
          accessibilityRole="toolbar"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, padding: space.xs, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surface }}
        >
          {TOOLS.map((tool) => button(tool.key, tool.label, t(tool.a11y), tool.active(state), () => ref.current && tool.run(ref.current), tool.style))}
          {button("link", t("richLink"), t("richLink"), !!state?.link.isActive, openLink)}
        </View>
        <EnrichedTextInput
          ref={ref}
          testID={testID}
          editable={!readOnly}
          defaultValue={initial}
          placeholder={placeholder}
          placeholderTextColor={c.muted}
          autoCapitalize="sentences"
          onChangeHtml={(e) => onChange(htmlToMarkdown(e.nativeEvent.value))}
          onChangeState={(e) => setState(e.nativeEvent)}
          onChangeSelection={(e) => (selection.current = e.nativeEvent)}
          onLinkDetected={(e) => (link.current = e)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          htmlStyle={{
            a: { color: c.primary, textDecorationLine: "underline" },
            ul: { bulletColor: c.text },
            ulCheckbox: { boxColor: c.primary },
            h1: { fontSize: 24, bold: true },
            h2: { fontSize: 21, bold: true },
            h3: { fontSize: 18, bold: true },
          }}
          style={{ minHeight: touch * 3, padding: space.m, fontSize: 17, color: c.text, fontFamily: fonts.text }}
        />
      </View>

      <Sheet visible={!!linking} onClose={() => setLinking(null)} title={t("richLink")} testID={testID ? `${testID}-link-sheet` : undefined}>
        {linking && (linking.editing || linking.start === linking.end) ? (
          <Field testID={testID ? `${testID}-link-text` : undefined} label={t("richLinkText")} value={linkText} onChangeText={setLinkText} />
        ) : null}
        <Field
          testID={testID ? `${testID}-link-url` : undefined}
          label={t("richLinkUrl")}
          value={linkUrl}
          onChangeText={(v) => {
            setLinkUrl(v);
            setLinkError(false);
          }}
          autoCapitalize="none"
          keyboardType="url"
          autoCorrect={false}
        />
        {linkError ? <Banner tone="danger" text={t("richLinkInvalid")} /> : null}
        <Button testID={testID ? `${testID}-link-save` : undefined} label={t("richLinkSave")} onPress={saveLink} />
        {linking?.editing ? <Button kind="danger" compact label={t("richLinkRemove")} onPress={removeLink} /> : null}
      </Sheet>
    </View>
  );
}
