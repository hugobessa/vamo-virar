import { router } from "expo-router";
import { useState } from "react";
import { confirm } from "../../lib/confirm";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { fromHex, toHex } from "@vamo-virar/protocol";
import { Text } from "react-native";
import { Banner, Body, Button, Card, Field, Heading } from "../kit";
import { useTheme } from "../theme";

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
          <Button kind="secondary" label={t("calendarsTitle")} onPress={() => router.push("/settings")} />
          {recovery ? (
            <Card>
              <Heading>{t("recoveryTitle")}</Heading>
              <Body muted>{t("recoveryHelp")}</Body>
              {showCode ? (
                <Text selectable testID="recovery-code" style={{ color: c.text, fontFamily: "monospace", fontSize: 16 }}>
                  {toHex(recovery).match(/.{4}/g)!.join(" ")}
                </Text>
              ) : null}
              <Button kind="secondary" label={showCode ? t("recoveryHide") : t("recoveryShow")} onPress={() => setShowCode(!showCode)} />
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
                    setRecoverMsg({ tone: "danger", text: `${t("error")}: ${e instanceof Error ? e.message : String(e)}` });
                  }
                }}
              />
              {recoverMsg ? <Banner tone={recoverMsg.tone} text={recoverMsg.text} /> : null}
            </Card>
          ) : null}
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
