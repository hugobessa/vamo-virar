import { REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReason } from "@vamo-virar/sync";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useApp } from "../../lib/context";
import type { StringKey } from "../../model/i18n";
import { Body, Button, Field, Heading } from "../kit";
import { fonts, radius, space, touch, useTheme } from "../theme";

/** Inline form to report one member to the admins. */
export function ReportForm({
  name,
  busy,
  onSend,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onSend: (reason: ReportReason, details: string) => void;
  onCancel: () => void;
}) {
  const { t } = useApp();
  const c = useTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  return (
    <View style={{ gap: space.s }}>
      <Heading>{`${t("reportTitle")}: ${name}`}</Heading>
      <Body muted>{t("reportHelp")}</Body>
      <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{t("reportWhy")}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: space.xs }}>
        {REPORT_REASONS.map((r) => {
          const on = r === reason;
          return (
            <Pressable
              key={r}
              testID={`report-reason-${r}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setReason(r)}
              style={{
                minHeight: touch,
                justifyContent: "center",
                paddingHorizontal: space.m,
                borderRadius: radius,
                borderWidth: on ? 2 : 1,
                borderColor: on ? c.primary : c.border,
                backgroundColor: c.bg,
              }}
            >
              <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 16, fontWeight: on ? "700" : "400" }}>{t(`reason_${r}` as StringKey)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field testID="report-details" label={t("reportDetails")} value={details} onChangeText={setDetails} multiline maxLength={REPORT_DETAILS_MAX} />
      <View style={{ flexDirection: "row", gap: space.s }}>
        <View style={{ flex: 1 }}>
          <Button testID="report-send" kind="danger" label={t("reportSend")} busy={busy} disabled={!reason} onPress={() => reason && onSend(reason, details)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button kind="secondary" label={t("cancel")} onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}
