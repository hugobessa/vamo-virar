// The source device's side of linking (protocol.md §10.5.5): a QR code with
// everything, or a link to copy plus a code that stays on this screen.

import type { LinkOffer } from "@vamo-virar/sync";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Text } from "react-native";
import { useApp } from "../lib/context";
import { copyOrShare, defaultDeviceLabel } from "../lib/devices";
import { errorText } from "../model/errors";
import { fill } from "../model/i18n";
import { Banner, Body, Button, Card, Heading, Screen, useToast } from "../ui/kit";
import { QrCode } from "../ui/QrCode";
import { fonts, useTheme } from "../ui/theme";

export default function LinkOfferScreen() {
  const { store, t } = useApp();
  const c = useTheme();
  const [offer, setOffer] = useState<LinkOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const [toast, showToast] = useToast();
  // Device names before this link: a new one appearing is the new device.
  const before = useRef(new Set(store.devices().map((d) => d.label)));
  const linked = store.devices().find((d) => !d.me && !before.current.has(d.label));
  const none = store.linkable().length === 0;

  useEffect(() => {
    if (none) return;
    let alive = true;
    let current: LinkOffer | null = null;
    setOffer(null);
    setTaken(false);
    setError(null);
    store
      .offerLink(store.devices().find((d) => d.me)?.label ?? defaultDeviceLabel())
      .then((o) => {
        current = o;
        if (alive) setOffer(o);
        else void o.cancel().catch(() => undefined);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
      // Leaving the screen withdraws a link nobody used.
      if (current) void current.cancel().catch(() => undefined);
    };
  }, [store, attempt, none]);

  // Watch for the bundle to be taken, then for the new device to join the set.
  useEffect(() => {
    if (!offer) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!taken) void offer.taken().then((v) => v && setTaken(true)).catch(() => undefined);
      else void store.syncAll();
    }, 2_000);
    return () => clearInterval(timer);
  }, [offer, taken, store]);

  if (none) {
    return (
      <Screen>
        <Banner tone="neutral" text={t("linkOfferNone")} />
      </Screen>
    );
  }
  // `now` ticks every 2 s; the offer may have arrived since the last tick.
  const at = Math.max(now, Date.now());
  const expired = !!offer && !taken && at > offer.expires;
  const minutes = offer ? Math.max(1, Math.ceil((offer.expires - at) / 60_000)) : 0;

  return (
    <Screen>
      {toast}
      {error ? <Banner tone="danger" text={error} /> : null}
      {linked ? (
        <>
          <Banner tone="ok" animated text={fill(t("linkDone"), { name: linked.label })} />
          <Button testID="link-done" label={t("devicesTitle")} onPress={() => router.replace("/devices")} />
        </>
      ) : taken ? (
        <Banner tone="ok" animated text={t("linkReceived")} />
      ) : expired ? (
        <>
          <Banner tone="warn" text={t("linkExpired")} />
          <Button label={t("linkNew")} onPress={() => setAttempt((n) => n + 1)} />
        </>
      ) : !offer ? (
        error ? <Button label={t("linkNew")} onPress={() => setAttempt((n) => n + 1)} /> : <Body muted>{t("linkPreparing")}</Body>
      ) : (
        <>
          <Body>{t("linkOfferIntro")}</Body>
          <QrCode testID="link-qr" value={offer.qr} />
          <Body muted>{fill(t("linkExpiresIn"), { min: minutes })}</Body>
          <Banner tone="warn" text={t("linkOfferPrivate")} />
          <Card>
            <Heading>{t("linkOfferCopyTitle")}</Heading>
            <Body muted>{t("linkOfferCopyHelp")}</Body>
            <Button
              kind="secondary"
              testID="link-copy"
              label={Platform.OS === "web" ? t("linkCopy") : t("linkShare")}
              onPress={() =>
                void copyOrShare(offer.copy)
                  .then((how) => how === "copied" && showToast(t("linkCopied")))
                  .catch(() => undefined)
              }
            />
            <Body muted>{t("linkCode")}</Body>
            <Text testID="link-code-shown" selectable style={{ color: c.text, fontFamily: fonts.display, fontSize: 32, fontWeight: "900", letterSpacing: 2 }}>
              {offer.code}
            </Text>
          </Card>
        </>
      )}
    </Screen>
  );
}
