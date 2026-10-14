// What was addressed to this person in a community: mentions, tasks handed
// to them, invitations. Opening the screen marks everything seen; what was
// unread on the way in keeps its "Nova" chip until the screen is left. The
// phone's own notifications are switched on from here too.

import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useApp, useCommunity } from "../../../lib/context";
import * as notifications from "../../../lib/notifications";
import { fill } from "../../../model/i18n";
import { latestSeq, NOTICE_TEXT, noticesFor, noticeSubject, type Notice } from "../../../model/notifications";
import { Actions, Banner, Body, Button, Card, Chip, EmptyState, Enter, Heading, Screen } from "../../../ui/kit";
import { nameOf } from "../../../ui/tasks/TaskBits";
import { fonts, motion, space, useTheme } from "../../../ui/theme";

/** A comment as a one-line preview: Markdown marks out, lines joined. */
const plain = (md: string) =>
  md
    .replace(/^\s*(#{1,3}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/\*\*|__|`|~~/g, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();

/** The card for turning the phone's notifications on. Nothing to do on the web. */
function PushCard() {
  const { t, store } = useApp();
  const [perm, setPerm] = useState<notifications.Permission | null>(null);
  useEffect(() => {
    void notifications.permission().then(setPerm);
  }, []);
  if (!notifications.pushSupported) return <Body muted>{t("pushUnavailable")}</Body>;
  return (
    <Card testID="push-card">
      <Heading>{t("pushTitle")}</Heading>
      <Body muted>{t("pushHelp")}</Body>
      {perm === "granted" ? <Chip label={t("pushOn")} tone="ok" /> : null}
      {perm === "denied" ? <Banner tone="warn" text={t("pushDenied")} /> : null}
      {perm === "undetermined" ? (
        <Actions>
          <Button
            testID="push-enable"
            label={t("pushEnable")}
            allowReadOnly
            onPress={async () => {
              const ok = await notifications.requestPermission();
              setPerm(ok ? "granted" : "denied");
              if (ok) void store.refreshPush();
            }}
          />
        </Actions>
      ) : null}
    </Card>
  );
}

export default function NotificationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, store } = useApp();
  const c = useTheme();
  const entry = useCommunity(id);
  const state = entry?.replica.view;
  const me = state?.members[entry?.replica.memberId ?? ""];
  const notices = state ? noticesFor(state, me) : [];
  // Unread on the way in stays marked while the screen is open.
  const seenBefore = useRef<number | null>(null);
  if (entry && seenBefore.current === null) seenBefore.current = entry.replica.noticeMarks.seen;
  const latest = latestSeq(notices);
  useEffect(() => {
    if (entry && latest > 0) store.markNoticesSeen(entry.id, latest);
  }, [store, entry, latest]);

  if (!entry || !state) {
    return (
      <Screen>
        <Body muted>{t("why_unknown_target")}</Body>
      </Screen>
    );
  }
  const open = (n: Notice) => {
    if (n.task) router.push({ pathname: "/c/[id]/task/[tid]", params: { id: entry.id, tid: n.task.task_id } });
    else if (n.event) router.push({ pathname: "/c/[id]/event/[eid]", params: { id: entry.id, eid: n.event.event_id } });
  };
  const unread = notices.filter((n) => n.seq > (seenBefore.current ?? 0)).length;
  return (
    <Screen width="board" onRefresh={() => store.syncOne(entry.id)}>
      <Stack.Screen options={{ title: t("notifications") }} />
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.s }}>
        <Heading>{state.community.name}</Heading>
        {unread > 0 ? <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 14 }}>{fill(t("notificationsUnread"), { n: unread })}</Text> : null}
      </View>
      {notices.length === 0 ? (
        <EmptyState testID="notifications-empty" title={t("notificationsEmpty")} body={t("notificationsEmptyBody")} />
      ) : (
        notices.map((n, i) => {
          const fresh = n.seq > (seenBefore.current ?? 0);
          return (
            <Enter key={n.id} delay={Math.min(i, 6) * motion.stagger}>
              <Card accent={fresh} testID={`notice-${n.id.replace(/:/g, "-").slice(0, 20)}`} onPress={() => open(n)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
                  <Text style={{ flex: 1, color: fresh ? c.brand : c.muted, fontFamily: fonts.text, fontSize: 14, fontWeight: "700" }}>
                    {fill(t(NOTICE_TEXT[n.kind]), { name: nameOf(state, n.by, "?") })}
                  </Text>
                  {fresh ? <Chip label={t("noticeNew")} tone="warn" /> : null}
                </View>
                <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 17, fontWeight: "700", lineHeight: 24 }}>{noticeSubject(n)}</Text>
                {n.comment ? (
                  <Text numberOfLines={2} style={{ color: c.muted, fontFamily: fonts.text, fontSize: 15, lineHeight: 21 }}>
                    {plain(n.comment.body)}
                  </Text>
                ) : null}
              </Card>
            </Enter>
          );
        })
      )}
      <PushCard />
    </Screen>
  );
}
