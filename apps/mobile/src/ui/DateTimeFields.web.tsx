// Web build: plain text fields (the end-to-end test types into them).

import { View } from "react-native";
import { useApp } from "../lib/context";
import { Field } from "./kit";
import { space } from "./theme";

export function DateTimeFields({ date, time, onChange }: { date: string; time: string; onChange: (date: string, time: string) => void }) {
  const { t } = useApp();
  return (
    <View style={{ flexDirection: "row", gap: space.s }}>
      <View style={{ flex: 1.4 }}>
        <Field testID="event-date" label={t("date")} value={date} onChangeText={(v) => onChange(v, time)} keyboardType="numbers-and-punctuation" />
      </View>
      <View style={{ flex: 1 }}>
        <Field testID="event-time" label={t("startTime")} value={time} onChangeText={(v) => onChange(date, v)} keyboardType="numbers-and-punctuation" />
      </View>
    </View>
  );
}
