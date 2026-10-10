import { router } from "expo-router";
import { useState } from "react";
import { confirm } from "../../lib/confirm";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { fromHex, toHex } from "@vamo-virar/protocol";
import { Text } from "react-native";
import { NodeClient } from "@vamo-virar/sync";
import { Banner, Body, Button, Card, Field, Heading } from "../kit";
import { useTheme } from "../theme";
import { errorText } from "../../model/errors";
import { WhatsAppEditor } from "../WhatsApp";

export function MeTab({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const r = entry.replica;
  const me = r.view?.members[r.memberId];
  const [name, setName] = useState(me?.profile?.display_name ?? "");
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [recoverMsg, setRecoverMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const c = useTheme();
  const recovery = r.recoveryKey;
  if (!me) return <Body muted>{t("syncRemoved")}</Body>;
  const removed = me.status !== "active";
  return (
    <>
      <Heading>{me.profile?.display_name}</Heading>
      {r.view?.community.description ? <Body muted>{r.view.community.description}</Body> : null}
      {removed ? (
        <Body muted>{t("syncRemoved")}</Body>
      ) : (
        <>
          <Field testID="my-name" label={t("editName")} value={name} onChangeText={setName} />
          <Button
            kind="secondary"
            label={t("save")}
            disabled={!name.trim() || name.trim() === me.profile?.display_name}
            onPress={() => store.submit(entry.id, "member.profile", { profile: { ...me.profile, display_name: name.trim() } })}
          />
          <Button kind="secondary" label={t("calendarsTitle")} allowReadOnly onPress={() => router.push("/settings")} />
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
          {!r.isAdmin ? (
            <Card>
              <Heading>{t("recoverTitle")}</Heading>
              <Body muted>{t("recoverHelp")}</Body>
              <Field label={t("recoverCode")} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} />
              <Button
                kind="secondary"
                label={t("recoverButton")}
                allowReadOnly
                disabled={code.replace(/\s/g, "").length !== 64}
                onPress={async () => {
                  setRecoverMsg(null);
                  try {
                    const seed = fromHex(code.replace(/\s/g, "").toLowerCase());
                    await store.admin(entry.id, async (rep) => {
                      await rep.recoverAdmins(seed, [rep.memberId]);
                      await rep.rotateIntakeKey();
                    });
                    setCode("");
                    setRecoverMsg({ tone: "ok", text: t("recoverDone") });
                  } catch (e) {
                    setRecoverMsg({ tone: "danger", text: errorText(e) });
                  }
                }}
              />
              {recoverMsg ? <Banner tone={recoverMsg.tone} text={recoverMsg.text} /> : null}
            </Card>
          ) : null}
          {r.isAdmin ? (
            <WhatsAppEditor
              key={r.view?.community.whatsapp ?? ""}
              testID="community-whatsapp-editor"
              title={t("whatsappCommunityTitle")}
              current={r.view?.community.whatsapp}
              onSave={(link) => store.submit(entry.id, "community.update", { whatsapp: link })}
            />
          ) : null}
          {r.isAdmin ? <MoveCard entry={entry} /> : null}
          {r.isAdmin ? <DisableCard entry={entry} /> : null}
          <Button
            kind="danger"
            label={t("leave")}
            onPress={async () => {
              if (await confirm(t("leaveConfirm"), t("yes"), t("no"))) store.submit(entry.id, "member.leave", {});
            }}
          />
        </>
      )}
    </>
  );
}

/**
 * Admins: mark the community for deletion (§11.5), or, for another admin,
 * cancel it. While disabled the rest of the tab is read-only; the enable
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
