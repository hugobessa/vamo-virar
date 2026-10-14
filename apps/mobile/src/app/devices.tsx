// The person's devices (protocol.md §10.5): which one is the main one, link
// another, rename this one, unlink.

import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { confirm } from "../lib/confirm";
import { useApp } from "../lib/context";
import { defaultDeviceLabel } from "../lib/devices";
import { errorText } from "../model/errors";
import { fill } from "../model/i18n";
import { Actions, Banner, Body, Button, Card, Chip, Field, Heading, Screen } from "../ui/kit";
import { space } from "../ui/theme";

export default function Devices() {
  const { store, t } = useApp();
  const devices = store.devices();
  const me = devices.find((d) => d.me);
  // Follows the stored name (which may load after the first render) until the person edits it.
  const [edited, setName] = useState<string | null>(null);
  const name = edited ?? me?.label ?? defaultDeviceLabel();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <Heading>{t("devicesTitle")}</Heading>
      <Body muted>{t("devicesIntro")}</Body>
      {error ? <Banner tone="danger" text={error} /> : null}
      {devices.length === 0 ? <Body>{t("devicesOnlyThis")}</Body> : null}
      {devices.map((d) => (
        <Card key={d.label} testID={`device-${d.label}`}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s }}>
            <Heading>{d.label}</Heading>
            {d.me ? <Chip label={t("deviceThis")} /> : null}
            {d.main ? <Chip label={t("deviceMain")} tone="ok" /> : null}
          </View>
          <Actions>
            {d.me && !d.main ? (
              <Button testID="device-make-main" kind="secondary" label={t("deviceMakeMain")} busy={busy === "main"} onPress={() => void run("main", () => store.makeThisMain())} />
            ) : null}
            {!d.me ? (
              <Button
                testID={`device-unlink-${d.label}`}
                kind="secondary"
                label={t("deviceUnlink")}
                busy={busy === d.label}
                onPress={async () => {
                  if (await confirm(fill(t("deviceUnlinkConfirm"), { name: d.label }), t("deviceUnlink"), t("no"))) await run(d.label, () => store.unlinkDevice(d.label));
                }}
              />
            ) : null}
          </Actions>
        </Card>
      ))}
      {devices.length > 1 ? <Body muted>{t("deviceMainHelp")}</Body> : null}
      <Button testID="link-another" label={t("linkAnother")} onPress={() => router.push("/link-offer")} />
      {me ? (
        <>
          <Field label={t("deviceName")} help={t("deviceNameHelp")} value={name} onChangeText={setName} maxLength={56} />
          <Actions>
            <Button kind="secondary" label={t("deviceRenameSave")} disabled={!name.trim() || name.trim() === me.label} busy={busy === "rename"} onPress={() => void run("rename", () => store.renameThisDevice(name))} />
            {devices.length > 1 ? (
              <Button
                testID="device-unlink-this"
                kind="secondary"
                label={t("deviceUnlinkThis")}
                busy={busy === "self"}
                onPress={async () => {
                  if (!(await confirm(t("deviceUnlinkThisConfirm"), t("deviceUnlink"), t("no")))) return;
                  await run("self", () => store.unlinkThisDevice());
                  router.replace("/");
                }}
              />
            ) : null}
          </Actions>
        </>
      ) : null}
    </Screen>
  );
}
