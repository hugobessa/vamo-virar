import { router } from "expo-router";
import { useState } from "react";
import { useApp } from "../lib/context";
import { Banner, Button, Field, Screen } from "../ui/kit";
import { errorText } from "../model/errors";

export default function Create() {
  const { store, t } = useApp();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [node, setNode] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ok = name.trim() && displayName.trim() && /^https?:\/\/\S+$/.test(node.trim());

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const id = await store.create({
        node: node.trim(),
        setupCode: setupCode.trim() || undefined,
        name: name.trim(),
        description: description.trim(),
        displayName: displayName.trim(),
      });
      router.replace({ pathname: "/c/[id]", params: { id } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field testID="community-name" label={t("communityName")} value={name} onChangeText={setName} />
      <Field testID="community-description" label={t("communityDescription")} value={description} onChangeText={setDescription} multiline />
      <Field testID="display-name" label={t("yourName")} help={t("yourNameHelp")} value={displayName} onChangeText={setDisplayName} autoComplete="name" />
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
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button testID="create-submit" label={busy ? t("creating") : t("create")} busy={busy} disabled={!ok} onPress={submit} />
    </Screen>
  );
}
