import { isWhatsAppLink } from "@vamo-virar/domain";
import { useState } from "react";
import { Linking } from "react-native";
import { useApp } from "../lib/context";
import { Actions, Button, Card, Field, Heading } from "./kit";

/** What a typed link means: empty, a valid group link, or invalid. */
export function parseWhatsApp(raw: string): { link?: string; invalid: boolean } {
  const v = raw.trim();
  if (!v) return { invalid: false };
  return isWhatsAppLink(v) ? { link: v, invalid: false } : { invalid: true };
}

/** Opens the group in WhatsApp. Works in a read-only community too. */
export function WhatsAppButton({ link, testID }: { link: string; testID?: string }) {
  const { t } = useApp();
  return <Button testID={testID} kind="secondary" label={t("whatsappOpen")} allowReadOnly onPress={() => void Linking.openURL(link)} />;
}

/** The optional link field for create forms, with inline validation. */
export function WhatsAppField({ value, onChangeText, testID }: { value: string; onChangeText: (s: string) => void; testID?: string }) {
  const { t } = useApp();
  return (
    <Field
      testID={testID}
      label={t("whatsappGroup")}
      help={t("whatsappHelp")}
      error={parseWhatsApp(value).invalid ? t("whatsappInvalid") : undefined}
      value={value}
      onChangeText={onChangeText}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      placeholder="https://chat.whatsapp.com/"
    />
  );
}

/** Set, change or remove a saved link. `onSave(null)` removes it. */
export function WhatsAppEditor({
  title,
  current,
  onSave,
  testID,
}: {
  title: string;
  current?: string;
  onSave: (link: string | null) => void;
  testID?: string;
}) {
  const { t } = useApp();
  const [value, setValue] = useState(current ?? "");
  const parsed = parseWhatsApp(value);
  return (
    <Card testID={testID}>
      <Heading>{title}</Heading>
      <WhatsAppField value={value} onChangeText={setValue} />
      <Actions>
        <Button
          kind="secondary"
          label={t("save")}
          disabled={!parsed.link || parsed.link === current}
          onPress={() => onSave(parsed.link!)}
        />
        {current ? (
          <Button
            kind="secondary"
            label={t("whatsappRemove")}
            onPress={() => {
              setValue("");
              onSave(null);
            }}
          />
        ) : null}
      </Actions>
    </Card>
  );
}
