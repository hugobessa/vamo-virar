import { GOOGLE, MICROSOFT } from "@vamo-virar/matching";
import * as AuthSession from "expo-auth-session";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Platform, Switch, View } from "react-native";
import { deviceCalendarsSupported, type SourceId } from "../lib/matching";
import { useApp, useCalendarService } from "../lib/context";
import type { StringKey } from "../model/i18n";
import { Banner, Body, Button, Card, Field, Heading, Screen } from "../ui/kit";
import { PlacesSettings } from "../ui/PlacesSettings";
import { space } from "../ui/theme";
import { errorText } from "../model/errors";

WebBrowser.maybeCompleteAuthSession();

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;
const googleClientId =
  Platform.select({ ios: extra.googleClientIdIos, android: extra.googleClientIdAndroid, default: extra.googleClientIdWeb }) ?? "";
const microsoftClientId = extra.microsoftClientId ?? "";
const redirectUri = AuthSession.makeRedirectUri({ scheme: "vamovirar", path: "oauth" });

/** One OAuth provider: PKCE authorization code flow, no client secret (§18). */
function useProvider(source: "google" | "microsoft") {
  const calendar = useCalendarService();
  const cfg = source === "google" ? GOOGLE : MICROSOFT;
  const clientId = source === "google" ? googleClientId : microsoftClientId;
  const [request, response, prompt] = AuthSession.useAuthRequest(
    {
      clientId: clientId || "unconfigured",
      redirectUri,
      scopes: [...cfg.scopes],
      usePKCE: true,
      ...(source === "google" ? { extraParams: { access_type: "offline", prompt: "consent" } } : {}),
    },
    cfg.discovery,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (response?.type !== "success" || !request?.codeVerifier) return;
    AuthSession.exchangeCodeAsync(
      { clientId, code: response.params.code!, redirectUri, extraParams: { code_verifier: request.codeVerifier } },
      cfg.discovery,
    )
      .then((tok) =>
        calendar.connectOAuth(source, {
          accessToken: tok.accessToken,
          ...(tok.refreshToken ? { refreshToken: tok.refreshToken } : {}),
          expiresAt: Date.now() + (tok.expiresIn ?? 3600) * 1000,
          clientId,
        }),
      )
      .catch((e: unknown) => setError(errorText(e)));
  }, [response, request, calendar, source, clientId, cfg.discovery]);

  return { available: !!clientId && !!request, prompt: () => prompt(), error };
}

export default function Settings() {
  const { t } = useApp();
  const calendar = useCalendarService();
  const google = useProvider("google");
  const microsoft = useProvider("microsoft");
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<SourceId | null>(null);
  const connected = new Set(calendar.connected());
  const prefs = calendar.prefs();

  useEffect(() => {
    void calendar.load();
  }, [calendar]);

  const row = (source: SourceId, connectedLabel: StringKey, connectLabel: StringKey, connect: () => Promise<unknown> | void, show: boolean) => {
    if (!show && !connected.has(source)) return null;
    const on = connected.has(source);
    const reauth = calendar.needsReauth(source);
    return (
      <Card key={source} testID={`calendar-${source}`}>
        <Body>{on ? t(connectedLabel) : t(connectLabel)}</Body>
        {on && !reauth ? (
          <Button kind="secondary" label={t("disconnect")} busy={busy === source} onPress={async () => {
            setBusy(source);
            await calendar.disconnect(source).finally(() => setBusy(null));
          }} />
        ) : (
          <Button label={reauth ? t("reconnect") : t(connectLabel)} busy={busy === source} onPress={async () => {
            setBusy(source);
            try {
              await connect();
            } finally {
              setBusy(null);
            }
          }} />
        )}
      </Card>
    );
  };

  return (
    <Screen>
      <Heading>{t("calendarsTitle")}</Heading>
      <Body muted>{t("calendarsPrivacy")}</Body>
      {denied ? <Banner tone="warn" text={t("calendarDenied")} /> : null}
      {row("device", "connectedPhone", "connectPhoneCalendar", async () => setDenied(!(await calendar.connectDevice())), deviceCalendarsSupported)}
      {row("google", "connectedGoogle", "connectGoogle", google.prompt, google.available)}
      {row("microsoft", "connectedMicrosoft", "connectMicrosoft", microsoft.prompt, microsoft.available)}
      {google.error || microsoft.error ? <Banner tone="danger" text={`${t("error")}: ${google.error ?? microsoft.error}`} /> : null}

      <Field
        label={t("bufferLabel")}
        value={String(prefs.bufferMinutes)}
        keyboardType="number-pad"
        onChangeText={(v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 0 && n <= 240) void calendar.setPrefs({ bufferMinutes: n });
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
        <Switch accessibilityLabel={t("allDayBlocks")} value={prefs.allDayBlocks} onValueChange={(v) => void calendar.setPrefs({ allDayBlocks: v })} />
        <View style={{ flex: 1 }}>
          <Body>{t("allDayBlocks")}</Body>
        </View>
      </View>
      <PlacesSettings />
    </Screen>
  );
}
