import { router } from "expo-router";
import { useState } from "react";
import { confirm } from "../../lib/confirm";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { Body, Button, Field, Heading } from "../kit";

export function MeTab({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const r = entry.replica;
  const me = r.view?.members[r.memberId];
  const [name, setName] = useState(me?.profile?.display_name ?? "");
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
