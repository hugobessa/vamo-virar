// One date on iOS and Android: a tappable field that opens the system picker
// and writes the same "DD/MM/AAAA" string the forms validate. The web build
// (DateField.web.tsx) keeps a plain text field.

import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useContext, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useApp } from "../lib/context";
import { formatDateInput, parseLocal } from "../model/time";
import { ReadOnly } from "./kit";
import { fonts, radius, space, touch, useTheme } from "./theme";

export function DateField({ value, onChange, testID }: { value: string; onChange: (date: string) => void; testID?: string }) {
  const { t } = useApp();
  const c = useTheme();
  const readOnly = useContext(ReadOnly);
  const [open, setOpen] = useState(false);
  const current = new Date(parseLocal(value, "12:00") ?? Date.now());
  const show = () => {
    if (readOnly) return;
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: current,
        mode: "date",
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === "set" && d) onChange(formatDateInput(d.getTime()));
        },
      });
      return;
    }
    setOpen((v) => !v);
  };
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${t("taskDuePick")}: ${value}`}
        accessibilityState={{ expanded: open, disabled: readOnly }}
        onPress={show}
        style={{ minHeight: touch, borderRadius: radius, borderWidth: open ? 2 : 1, borderColor: open ? c.primary : c.border, backgroundColor: c.bg, paddingHorizontal: space.m, justifyContent: "center" }}
      >
        <Text style={{ color: value ? c.text : c.muted, fontFamily: fonts.text, fontSize: 17 }}>{value || t("taskDuePick")}</Text>
      </Pressable>
      {open && Platform.OS === "ios" ? (
        <DateTimePicker value={current} mode="date" display="inline" locale="pt-BR" onChange={(_e: DateTimePickerEvent, d?: Date) => d && onChange(formatDateInput(d.getTime()))} />
      ) : null}
    </View>
  );
}
