// The new device's side of linking (protocol.md §10.5.5): scan the QR, or
// paste a copied link and type the code shown on the other device.

import { isDeviceLink, parseDeviceLink } from "@vamo-virar/sync";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Platform } from "react-native";
import { confirm } from "../lib/confirm";
import { useApp } from "../lib/context";
import { defaultDeviceLabel } from "../lib/devices";
import { errorText } from "../model/errors";
import { fill } from "../model/i18n";
import { Banner, Body, Button, Field, FormSection, Screen } from "../ui/kit";
import { ScanQr } from "../ui/ScanQr";

export default function Link() {
  const { store, t } = useApp();
  // Opened from a vamovirar://link?n=…&c=…&s=… link, the params are already here.
  const params = useLocalSearchParams<{ n?: string; c?: string; s?: string; w?: string }>();
  // In the browser, an https://…/link#… link keeps everything in the fragment.
  const hash = Platform.OS === "web" ? (globalThis.location?.hash?.replace(/^#/, "") ?? "") : "";
  const fromLink =
    params.n && params.c && params.s
      ? `vamovirar://link?n=${encodeURIComponent(params.n)}&c=${params.c}&s=${params.s}${params.w ? `&w=${params.w}` : ""}`
      : hash.includes("s=")
        ? `vamovirar://link?${hash}`
        : "";
  const [link, setLink] = useState(fromLink);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState(defaultDeviceLabel);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      return parseDeviceLink(link.trim());
    } catch {
      return null;
    }
  }, [link]);
  const needsCode = !!parsed && !parsed.code;

  async function submit(text = link, typed = code) {
    const l = parseDeviceLink(text.trim());
    setBusy(true);
    setError(null);
    try {
      const incoming = await store.receiveLink(text.trim(), l.code ?? typed);
      const replace = new Set<string>();
      for (const c of incoming.conflicts) {
        if (await confirm(fill(t("linkConflict"), { name: c.name }), t("linkReplace"), t("linkKeep"))) replace.add(c.id);
      }
      const added = await store.applyLink(incoming, label.trim() || defaultDeviceLabel(), replace);
      // The link is spent; keep it out of the browser's history anyway.
      if (Platform.OS === "web") globalThis.history?.replaceState(null, "", globalThis.location?.pathname ?? "/");
      if (added.length === 1) router.replace({ pathname: "/c/[id]", params: { id: added[0]! } });
      else router.replace("/");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Body muted>{t("linkReceiveIntro")}</Body>
      {scanning ? (
        <ScanQr
          accept={isDeviceLink}
          onClose={() => setScanning(false)}
          onScan={(text) => {
            setScanning(false);
            setLink(text);
            // The QR carries the code: nothing left to type.
            if (parseDeviceLink(text).code) void submit(text);
          }}
        />
      ) : (
        <Button testID="link-scan" label={t("linkScan")} disabled={busy} onPress={() => setScanning(true)} />
      )}
      <FormSection title={t("linkPaste")}>
        <Field
          testID="link-url"
          label={t("linkField")}
          value={link}
          onChangeText={setLink}
          autoCapitalize="none"
          autoCorrect={false}
          error={link && !parsed ? t("linkInvalid") : undefined}
        />
        {needsCode ? (
          <Field
            testID="link-code"
            label={t("linkCodeTyped")}
            help={t("linkCodeHelp")}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        ) : null}
        <Field testID="link-label" label={t("deviceName")} help={t("deviceNameHelp")} value={label} onChangeText={setLabel} maxLength={56} />
      </FormSection>
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button
        testID="link-submit"
        label={busy ? t("linkWorking") : t("linkSubmit")}
        busy={busy}
        disabled={!parsed || (needsCode && code.replace(/[\s-]/g, "").length !== 10)}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
