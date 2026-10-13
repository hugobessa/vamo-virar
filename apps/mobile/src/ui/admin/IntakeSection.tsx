// "Entrada": the people asking to join, and the invite link that lets someone ask.

import type { PendingJoin } from "@vamo-virar/sync";
import { useState } from "react";
import { Share, Text, View } from "react-native";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { Actions, Body, Button, Card, Enter, Heading } from "../kit";
import { useLayout } from "../layout";
import { motion, useTheme } from "../theme";
import type { AdminRunner } from "./hooks";

const profileName = (p: unknown) => (p && typeof p === "object" && "display_name" in p ? String((p as { display_name: unknown }).display_name) : "?");

export function IntakeSection({ entry, requests, reload, runner }: { entry: CommunityEntry; requests: PendingJoin[] | null; reload: () => Promise<void>; runner: AdminRunner }) {
  const { t } = useApp();
  const c = useTheme();
  const l = useLayout();
  const r = entry.replica;
  const [invite, setInvite] = useState<string | null>(null);
  const { busy, run } = runner;
  return (
    <>
      <Body muted>{t("adminIntakeHelp")}</Body>
      <Heading>{t("joinRequests")}</Heading>
      {requests === null || requests.length === 0 ? <Body muted>{t("noRequests")}</Body> : null}
      {requests?.map((p, i) => (
        <Enter key={p.intakeId} delay={i * motion.stagger}>
          <Card testID={`request-${p.intakeId}`}>
            <Body>{profileName(p.request.profile)}</Body>
            {p.request.message ? <Body muted>{p.request.message}</Body> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={l.compact ? { flex: 1 } : null}>
                <Button testID={`approve-${p.intakeId}`} label={t("accepted")} haptic="confirm" busy={busy === `a${p.intakeId}`} onPress={() => run(`a${p.intakeId}`, () => r.approve(p), reload)} />
              </View>
              <View style={l.compact ? { flex: 1 } : null}>
                <Button kind="secondary" label={t("refuse")} busy={busy === `r${p.intakeId}`} onPress={() => run(`r${p.intakeId}`, () => r.reject(p), reload)} />
              </View>
            </View>
          </Card>
        </Enter>
      ))}
      {r.isAdmin ? (
        <>
          <Heading>{t("createInvite")}</Heading>
          <Body muted>{t("inviteOnce")}</Body>
          <Actions>
            <Button
              testID="create-invite"
              kind="secondary"
              label={t("createInvite")}
              busy={busy === "invite"}
              onPress={() =>
                run("invite", async (rep) => {
                  setInvite(await rep.createInvite({ maxUses: 1 }));
                })
              }
            />
          </Actions>
          {invite ? (
            <Card>
              <Text testID="invite-text" selectable style={{ color: c.text }}>
                {invite}
              </Text>
              <Button label={t("shareInvite")} onPress={() => void Share.share({ message: invite })} />
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
