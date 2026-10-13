// "Comunidade", for admins: the WhatsApp group, the recovery code, moving
// to another server, and disabling the community (marking it for deletion).

import { toHex } from "@vamo-virar/protocol";
import { NodeClient } from "@vamo-virar/sync";
import { useState } from "react";
import { Text } from "react-native";
import { confirm } from "../../lib/confirm";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { errorText } from "../../model/errors";
import { Banner, Body, Button, Card, Field, Heading } from "../kit";
import { useTheme } from "../theme";
import { WhatsAppEditor } from "../WhatsApp";

export function CommunitySection({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const c = useTheme();
  const r = entry.replica;
  const [showCode, setShowCode] = useState(false);
  const recovery = r.recoveryKey;
  return (
    <>
      <Body muted>{t("adminCommunityHelp")}</Body>
      <WhatsAppEditor
        key={r.view?.community.whatsapp ?? ""}
        testID="community-whatsapp-editor"
        title={t("whatsappCommunityTitle")}
        current={r.view?.community.whatsapp}
        onSave={(link) => store.submit(entry.id, "community.update", { whatsapp: link })}
      />
      {recovery ? (
        <Card>
          <Heading>{t("recoveryTitle")}</Heading>
          <Body muted>{t("recoveryHelp")}</Body>
          {showCode ? (
            <Text selectable testID="recovery-code" style={{ color: c.text, fontFamily: "monospace", fontSize: 16 }}>
              {toHex(recovery).match(/.{4}/g)!.join(" ")}
            </Text>
          ) : null}
          <Button kind="secondary" label={showCode ? t("recoveryHide") : t("recoveryShow")} allowReadOnly onPress={() => setShowCode(!showCode)} />
        </Card>
      ) : null}
      <MoveCard entry={entry} />
      <DisableCard entry={entry} />
    </>
  );
}

/**
 * Admins: mark the community for deletion (§11.5), or, for another admin,
 * cancel it. While disabled the rest of the screen is read-only; the enable
 * button is not.
 */
function DisableCard({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const r = entry.replica;
  const d = r.disabled;
  const iDisabledIt = !!d && d.by === r.view?.members[r.memberId]?.msk;
  async function run(question: string, f: () => Promise<void>) {
    if (!(await confirm(question, t("yes"), t("no")))) return;
    setBusy(true);
    setMsg(null);
    try {
      await store.admin(entry.id, f);
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card testID="disable-card">
      <Heading>{t(d ? "enableTitle" : "disableTitle")}</Heading>
      {!d ? (
        <>
          <Body muted>{t("disableHelp")}</Body>
          <Button testID="disable-community" kind="danger" label={t("disableButton")} busy={busy} onPress={() => run(t("disableConfirm"), () => r.disableCommunity())} />
        </>
      ) : iDisabledIt ? (
        <Body muted>{t("enableNeedsOther")}</Body>
      ) : (
        <>
          <Body muted>{t("enableHelp")}</Body>
          <Button testID="enable-community" label={t("enableButton")} busy={busy} allowReadOnly onPress={() => run(t("enableConfirm"), () => r.enableCommunity())} />
        </>
      )}
      {msg ? <Banner tone="danger" text={msg} /> : null}
    </Card>
  );
}

/** Admins: move the community to another server (managed ↔ self-hosted). */
function MoveCard({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const [address, setAddress] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const valid = /^https?:\/\/\S+$/.test(address.trim());
  return (
    <Card>
      <Heading>{t("moveTitle")}</Heading>
      <Body muted>{t("moveHelp")}</Body>
      <Body muted>{`${t("movedFrom")}: ${entry.replica.node}`}</Body>
      <Field
        testID="move-address"
        label={t("serverAddress")}
        value={address}
        onChangeText={setAddress}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Field testID="move-setup-code" label={t("setupCode")} value={setupCode} onChangeText={setSetupCode} autoCapitalize="none" autoCorrect={false} />
      <Button
        testID="move-button"
        kind="secondary"
        label={t("moveButton")}
        busy={busy}
        disabled={!valid || busy}
        onPress={async () => {
          if (!(await confirm(t("moveConfirm"), t("yes"), t("no")))) return;
          setBusy(true);
          setMsg(null);
          try {
            const target = new NodeClient(address.trim(), setupCode.trim() ? { provisioningToken: setupCode.trim() } : {});
            await store.admin(entry.id, (rep) => rep.migrateTo(target));
            setAddress("");
            setSetupCode("");
            setMsg({ tone: "ok", text: t("moveDone") });
          } catch (e) {
            setMsg({ tone: "danger", text: errorText(e) });
          } finally {
            setBusy(false);
          }
        }}
      />
      {msg ? <Banner tone={msg.tone} text={msg.text} /> : null}
    </Card>
  );
}
