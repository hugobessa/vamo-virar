import { Linking, Text } from "react-native";
import { useApp } from "../lib/context";
import { Banner, Body, Button, Card, Heading, Screen } from "../ui/kit";
import { fonts, useTheme } from "../ui/theme";

/** Child safety point of contact (docs/child-safety.md §5). */
export const SAFETY_EMAIL = "vamovirar@bessa.me";

/**
 * How to raise a concern from inside the app: our contact, in-community
 * reports and the authorities. Reachable from the home screen without
 * joining a community (Google Play Child Safety Standards).
 */
export default function Safety() {
  const { t } = useApp();
  const c = useTheme();
  return (
    <Screen>
      <Heading>{t("safetyTitle")}</Heading>
      <Body>{t("safetyIntro")}</Body>
      <Banner tone="danger" text={t("safetyEmergency")} />

      <Card testID="safety-contact">
        <Heading>{t("safetyContactTitle")}</Heading>
        <Body>{t("safetyContactBody")}</Body>
        <Text testID="safety-email" selectable style={{ color: c.text, fontFamily: fonts.text, fontSize: 18, fontWeight: "700" }}>
          {SAFETY_EMAIL}
        </Text>
        <Body muted>{t("safetyContactInfo")}</Body>
        <Button
          kind="secondary"
          label={t("safetyWrite")}
          allowReadOnly
          onPress={() => void Linking.openURL(`mailto:${SAFETY_EMAIL}?subject=${encodeURIComponent("Segurança infantil")}`).catch(() => undefined)}
        />
      </Card>

      <Card>
        <Heading>{t("safetyCommunityTitle")}</Heading>
        <Body>{t("safetyCommunitySteps")}</Body>
      </Card>

      <Card>
        <Heading>{t("safetyAuthoritiesTitle")}</Heading>
        <Text selectable style={{ color: c.text, fontFamily: fonts.text, fontSize: 16, lineHeight: 26 }}>
          {t("safetyAuthorities")}
        </Text>
      </Card>
    </Screen>
  );
}
