// A comment box that understands `@`: while a name is being typed after an
// `@`, the people who match appear as chips under the box; tapping one puts
// the full name in. The screen gets the text and, on send, the member ids
// (`extractMentions`) to put in the op.

import { useState } from "react";
import { Pressable, Text, View, type TextInputProps } from "react-native";
import { useApp } from "../../lib/context";
import { insertMention, mentionQuery, suggestMentions, type Mentionable } from "../../model/mentions";
import { Field } from "../kit";
import { fonts, radius, space, touch, useTheme } from "../theme";

export function MentionField({
  people,
  value,
  onChangeText,
  testID,
  ...props
}: Omit<TextInputProps, "value" | "onChangeText"> & { label: string; help?: string; people: Mentionable[]; value: string; onChangeText: (text: string) => void; testID?: string }) {
  const { t } = useApp();
  const c = useTheme();
  const [caret, setCaret] = useState(value.length);
  // The caret after a pick, applied on the next layout so the input shows it.
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const q = mentionQuery(value, Math.min(caret, value.length));
  const options = q ? suggestMentions(people, q.query) : [];
  return (
    <View style={{ gap: space.s }}>
      <Field
        testID={testID}
        {...props}
        multiline
        value={value}
        help={props.help ?? (people.length > 0 ? t("mentionHint") : undefined)}
        selection={selection}
        onSelectionChange={(e) => {
          setSelection(undefined);
          setCaret(e.nativeEvent.selection.end);
        }}
        onChangeText={(text) => {
          // Typing moves the caret to the end of the change; selection events follow but not on every platform.
          setCaret((at) => at + (text.length - value.length));
          onChangeText(text);
        }}
      />
      {options.length > 0 ? (
        <View testID={`${testID ?? "mention"}-suggestions`} accessibilityRole="list" accessibilityLabel={t("mentionPeople")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
          {options.map((p) => (
            <Pressable
              key={p.member_id}
              testID={`mention-pick-${p.member_id.slice(0, 8)}`}
              accessibilityRole="button"
              accessibilityLabel={`@${p.name}`}
              onPress={() => {
                const next = insertMention(value, Math.min(caret, value.length), p.name);
                onChangeText(next.text);
                setCaret(next.caret);
                setSelection({ start: next.caret, end: next.caret });
              }}
              style={({ pressed }) => ({ minHeight: touch - 12, justifyContent: "center", paddingHorizontal: space.m, borderRadius: radius, backgroundColor: pressed ? c.primary : c.chip })}
            >
              {({ pressed }) => <Text style={{ color: pressed ? c.primaryText : c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>@{p.name}</Text>}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
