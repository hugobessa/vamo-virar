import { router } from "expo-router";
import { useState } from "react";
import { useApp } from "../lib/context";
import { Banner, Body, Button, Field, FormSection, Screen } from "../ui/kit";
import { errorDetail, errorText } from "../model/errors";
import { parseWhatsApp, WhatsAppField } from "../ui/WhatsApp";

export default function Create() {
  const { store, t } = useApp();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [node, setNode] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const wa = parseWhatsApp(whatsapp);
  const ok = name.trim() && displayName.trim() && /^https?:\/\/\S+$/.test(node.trim()) && !wa.invalid;

  async function submit() {
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      const id = await store.create({
        node: node.trim(),
        setupCode: setupCode.trim() || undefined,
        name: name.trim(),
        description: description.trim(),
        whatsapp: wa.link,
        displayName: displayName.trim(),
      });
      router.replace({ pathname: "/c/[id]", params: { id } });
    } catch (e) {
      console.warn("create failed", e);
      setError(errorText(e));
      setDetail(errorDetail(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Body muted>{t("createIntro")}</Body>
      <FormSection title={t("sectionCommunity")}>
        <Field testID="community-name" label={t("communityName")} value={name} onChangeText={setName} />
        <Field testID="community-description" label={t("communityDescription")} value={description} onChangeText={setDescription} multiline />
        <WhatsAppField testID="community-whatsapp" value={whatsapp} onChangeText={setWhatsapp} />
      </FormSection>
      <FormSection title={t("sectionYou")}>
        <Field testID="display-name" label={t("yourName")} help={t("yourNameHelp")} value={displayName} onChangeText={setDisplayName} autoComplete="name" />
      </FormSection>
      <FormSection title={t("sectionServer")}>
        <Field
          testID="node-url"
          label={t("serverAddress")}
          help={t("serverAddressHelp")}
          value={node}
          onChangeText={setNode}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://"
        />
        <Field testID="setup-code" label={t("setupCode")} value={setupCode} onChangeText={setSetupCode} autoCapitalize="none" secureTextEntry />
      </FormSection>
      {error ? <Banner tone="danger" text={error} /> : null}
      {detail ? <Body muted>{`${t("errorDetail")} ${detail}`}</Body> : null}
      <Button testID="create-submit" label={busy ? t("creating") : t("create")} busy={busy} disabled={!ok} onPress={submit} />
    </Screen>
  );
}
