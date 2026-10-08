import { isAdmin, type MemberRecord } from "@vamo-virar/domain";
import type { PendingJoin } from "@vamo-virar/sync";
import { useCallback, useEffect, useState } from "react";
import { Share, Text, View } from "react-native";
import { confirm } from "../../lib/confirm";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { roleKey } from "../../model/events";
import { Banner, Body, Button, Card, Chip, Heading } from "../kit";
import { space, useTheme } from "../theme";
import { errorText } from "../../model/errors";

export function PeopleTab({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const c = useTheme();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const admin = !!me && isAdmin(state, me);
  const [requests, setRequests] = useState<PendingJoin[] | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!admin) return;
    try {
      setRequests(await r.joinRequests());
    } catch {
      setRequests(null);
    }
  }, [admin, r]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function run(key: string, f: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await store.admin(entry.id, f);
      await loadRequests();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const members = Object.values(state.members)
    .filter((m) => m.status === "active")
    .sort((a, b) => (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? ""));

  const profileName = (p: unknown) => (p && typeof p === "object" && "display_name" in p ? String((p as { display_name: unknown }).display_name) : "?");

  return (
    <>
      {error ? <Banner tone="danger" text={error} /> : null}
      {admin ? (
        <>
          <Heading>{t("joinRequests")}</Heading>
          {requests === null || requests.length === 0 ? <Body muted>{t("noRequests")}</Body> : null}
          {requests?.map((p) => (
            <Card key={p.intakeId} testID={`request-${p.intakeId}`}>
              <Body>{profileName(p.request.profile)}</Body>
              {p.request.message ? <Body muted>{p.request.message}</Body> : null}
              <View style={{ flexDirection: "row", gap: space.s }}>
                <View style={{ flex: 1 }}>
                  <Button testID={`approve-${p.intakeId}`} label={t("accepted")} busy={busy === `a${p.intakeId}`} onPress={() => run(`a${p.intakeId}`, () => r.approve(p))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button kind="secondary" label={t("refuse")} busy={busy === `r${p.intakeId}`} onPress={() => run(`r${p.intakeId}`, () => r.reject(p))} />
                </View>
              </View>
            </Card>
          ))}
          <Button
            testID="create-invite"
            kind="secondary"
            label={t("createInvite")}
            busy={busy === "invite"}
            onPress={() =>
              run("invite", async () => {
                setInvite(await r.createInvite({ maxUses: 1 }));
              })
            }
          />
          {invite ? (
            <Card>
              <Text testID="invite-text" selectable style={{ color: c.text }}>
                {invite}
              </Text>
              <Body muted>{t("inviteOnce")}</Body>
              <Button label={t("shareInvite")} onPress={() => void Share.share({ message: invite })} />
            </Card>
          ) : null}
        </>
      ) : null}
      <Heading>{t("tabPeople")}</Heading>
      {members.map((m: MemberRecord) => (
        <Card key={m.member_id} testID={`member-${m.member_id}`}>
          <Body>{m.profile?.display_name ?? "?"}</Body>
          <Chip label={t(roleKey(state, m))} />
          {admin && m.member_id !== r.memberId ? (
            <View style={{ gap: space.s }}>
              {m.role === "member" ? (
                <Button kind="secondary" label={t("makeOrganizer")} onPress={() => store.submit(entry.id, "member.role", { member_id: m.member_id, role: "organizer" })} />
              ) : null}
              {!isAdmin(state, m) ? (
                <Button kind="secondary" label={t("makeAdmin")} busy={busy === `adm${m.member_id}`} onPress={() => run(`adm${m.member_id}`, () => r.makeAdmin(m.member_id))} />
              ) : null}
              <Button
                kind="danger"
                label={t("remove")}
                busy={busy === `rm${m.member_id}`}
                onPress={async () => {
                  if (await confirm(t("removeConfirm"), t("yes"), t("no"))) await run(`rm${m.member_id}`, () => r.removeMember(m.member_id));
                }}
              />
            </View>
          ) : null}
        </Card>
      ))}
    </>
  );
}
