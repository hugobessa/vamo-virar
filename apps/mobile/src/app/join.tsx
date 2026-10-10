import { parseInvite } from "@vamo-virar/sync";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { useApp } from "../lib/context";
import { Banner, Body, Button, Field, FormSection, Screen } from "../ui/kit";
import { errorText } from "../model/errors";

export default function Join() {
  const { store, t } = useApp();
  // Opened from a vamovirar://join?c=…&n=…&k=…&i=… link, the params are already here.
  const params = useLocalSearchParams<{ c?: string; n?: string; k?: string; i?: string }>();
  const fromLink = params.c && params.n && params.k
    ? `vamovirar://join?c=${params.c}&n=${encodeURIComponent(params.n)}&k=${params.k}${params.i ? `&i=${params.i}` : ""}`
    : "";
  const [link, setLink] = useState(fromLink);
  const [displayName, setDisplayName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkOk = useMemo(() => {
    try {
      parseInvite(link.trim());
      return true;
    } catch {
      return false;
    }
  }, [link]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const id = await store.join(link, {
        displayName: displayName.trim(),
        contact: contact.trim() || undefined,
        message: message.trim() || undefined,
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
      <Body muted>{t("joinIntro")}</Body>
      <FormSection title={t("sectionInvite")}>
        <Field
          testID="invite-link"
          label={t("pasteInvite")}
          value={link}
          onChangeText={setLink}
          autoCapitalize="none"
          error={link && !linkOk ? t("inviteInvalid") : undefined}
        />
      </FormSection>
      <FormSection title={t("sectionYou")}>
        <Field testID="display-name" label={t("yourName")} help={t("yourNameHelp")} value={displayName} onChangeText={setDisplayName} />
        <Field label={t("contactOptional")} value={contact} onChangeText={setContact} />
        <Field label={t("messageToOrganizers")} value={message} onChangeText={setMessage} multiline />
      </FormSection>
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button
        testID="join-submit"
        label={busy ? t("requesting") : t("requestToJoin")}
        busy={busy}
        disabled={!linkOk || !displayName.trim()}
        onPress={submit}
      />
    </Screen>
  );
}
