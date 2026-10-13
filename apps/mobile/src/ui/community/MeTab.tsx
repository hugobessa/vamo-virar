// This person in the community: their name, the app's own screens, the way
// back in if the coordination is lost, and leaving. The community's settings
// are on the administration screen.

import { fromHex } from "@vamo-virar/protocol";
import { router } from "expo-router";
import { useState } from "react";
import { confirm } from "../../lib/confirm";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { errorText } from "../../model/errors";
import { roleKey } from "../../model/events";
import { Actions, Banner, Body, Button, Card, Chip, Collapsible, Columns, Field, Heading } from "../kit";
import { useLayout } from "../layout";

export function MeTab({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const r = entry.replica;
  const state = r.view;
  const me = state?.members[r.memberId];
  const [name, setName] = useState(me?.profile?.display_name ?? "");
  const [code, setCode] = useState("");
  const [recoverMsg, setRecoverMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const l = useLayout();
  if (!me || !state) return <Body muted>{t("syncRemoved")}</Body>;
  const removed = me.status !== "active";
  if (removed) {
    return (
      <>
        <Heading>{me.profile?.display_name}</Heading>
        {state.community.description ? <Body muted>{state.community.description}</Body> : null}
        <Body muted>{t("syncRemoved")}</Body>
      </>
    );
  }
  const main = (
    <>
      <Heading>{me.profile?.display_name}</Heading>
      <Chip label={t(roleKey(state, me))} />
      {state.community.description ? <Body muted>{state.community.description}</Body> : null}
      <Field testID="my-name" label={t("editName")} value={name} onChangeText={setName} />
      <Actions>
        <Button
          kind="secondary"
          label={t("save")}
          disabled={!name.trim() || name.trim() === me.profile?.display_name}
          onPress={() => store.submit(entry.id, "member.profile", { profile: { ...me.profile, display_name: name.trim() } })}
        />
      </Actions>
      {/* With the sidebar on screen these two are already there. */}
      {l.sidebar ? null : (
        <Actions>
          <Button kind="secondary" label={t("calendarsTitle")} allowReadOnly onPress={() => router.push("/settings")} />
          <Button testID="me-safety" kind="secondary" label={t("safetyTitle")} allowReadOnly onPress={() => router.push("/safety")} />
        </Actions>
      )}
    </>
  );
  const aside = (
    <>
      {/* Taking over a community whose coordination lost every phone is rare: folded away under "Avançado". */}
      {!r.isAdmin ? (
        <Collapsible title={t("advanced")} testID="advanced">
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
        </Collapsible>
      ) : null}
      <Actions>
        <Button
          kind="danger"
          label={t("leave")}
          onPress={async () => {
            if (await confirm(t("leaveConfirm"), t("yes"), t("no"))) store.submit(entry.id, "member.leave", {});
          }}
        />
      </Actions>
    </>
  );
  return <Columns main={main} aside={aside} />;
}
