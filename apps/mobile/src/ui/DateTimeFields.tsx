// Date and start-time entry on iOS and Android: tappable fields that open the
// system pickers, writing the same "DD/MM/AAAA" and "HH:MM" strings the rest
// of the form validates. The web build (DateTimeFields.web.tsx) keeps plain
// text fields, which the end-to-end test types into.

import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useContext, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useApp } from "../lib/context";
import { formatDateInput, formatTimeInput, parseLocal } from "../model/time";
import { ReadOnly } from "./kit";
import { fonts, radius, space, touch, useTheme } from "./theme";

type Mode = "date" | "time";

export function DateTimeFields({ date, time, onChange }: { date: string; time: string; onChange: (date: string, time: string) => void }) {
  const { t } = useApp();
  const c = useTheme();
  const readOnly = useContext(ReadOnly);
  const [open, setOpen] = useState<Mode | null>(null);
  const value = new Date(parseLocal(date, time) ?? Date.now());

  const pick = (mode: Mode, d: Date) => {
    if (mode === "date") onChange(formatDateInput(d.getTime()), time);
    else onChange(date, formatTimeInput(d.getTime()));
  };
  const show = (mode: Mode) => {
    if (readOnly) return;
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value,
        mode,
        is24Hour: true,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === "set" && d) pick(mode, d);
        },
      });
      return;
    }
    setOpen((v) => (v === mode ? null : mode));
  };

  const field = (mode: Mode, label: string, text: string, testID: string) => (
    <View style={{ flex: 1, gap: space.xs }}>
      <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${text}`}
        accessibilityState={{ expanded: open === mode, disabled: readOnly }}
        onPress={() => show(mode)}
        style={{ minHeight: touch, borderRadius: radius, borderWidth: open === mode ? 2 : 1, borderColor: open === mode ? c.primary : c.border, backgroundColor: c.bg, paddingHorizontal: space.m, justifyContent: "center" }}
      >
        <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 17 }}>{text}</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={{ gap: space.s }}>
      <View style={{ flexDirection: "row", gap: space.s }}>
        {field("date", t("dateLabel"), date, "event-date")}
        {field("time", t("timeLabel"), time, "event-time")}
      </View>
      {open && Platform.OS === "ios" ? (
        <DateTimePicker
          value={value}
          mode={open}
          display="spinner"
          locale="pt-BR"
          onChange={(_e: DateTimePickerEvent, d?: Date) => {
            if (d) pick(open, d);
          }}
        />
      ) : null}
    </View>
  );
}
