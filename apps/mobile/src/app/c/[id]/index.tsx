import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useApp, useCommunity } from "../../../lib/context";
import { reasonKey } from "../../../model/i18n";
import { unreadNotices } from "../../../model/notifications";
import { syncStatusKey } from "../../../model/sync-status";
import { newsFor } from "../../../model/tasks";
import { EventsTab } from "../../../ui/community/EventsTab";
import { MeTab } from "../../../ui/community/MeTab";
import { DisabledScope } from "../../../ui/community/Disabled";
import { PeopleTab } from "../../../ui/community/PeopleTab";
import { TasksTab } from "../../../ui/community/TasksTab";
import { Actions, Banner, BellButton, Body, Screen, Segmented, Title } from "../../../ui/kit";
import { fonts, space, useTheme } from "../../../ui/theme";
import { WhatsAppButton } from "../../../ui/WhatsApp";

type Tab = "events" | "tasks" | "people" | "me";
const TABS: readonly Tab[] = ["events", "tasks", "people", "me"];

/** "Tudo em dia" is a small green dot; anything else slides in as a banner. */
function SyncStatus({ status }: { status: ReturnType<typeof syncStatusKey> }) {
  const { t } = useApp();
  const c = useTheme();
  if (status.key === "syncUpToDate") {
    return (
      <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.s, alignSelf: "flex-end" }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.green }} />
        <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 13 }}>{t(status.key)}</Text>
      </View>
    );
  }
  return <Banner animated tone={status.tone} text={t(status.key)} />;
}

export default function Community() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { t, store } = useApp();
  const entry = useCommunity(id);
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "events");

  useEffect(() => {
    if (id) void store.syncOne(id);
  }, [id, store]);

  if (!entry) return <Screen><Body>…</Body></Screen>;
  const r = entry.replica;
  const state = r.view;

  if (r.status === "joining" || r.status === "rejected" || !state) {
    const rejected = r.status === "rejected";
    return (
      <Screen>
        <Stack.Screen options={{ title: t(rejected ? "rejectedTitle" : "waitingTitle") }} />
        <Title>{t(rejected ? "rejectedTitle" : "waitingTitle")}</Title>
        <Body muted>{t(rejected ? "rejectedBody" : "waitingBody")}</Body>
      </Screen>
    );
  }

  const sync = syncStatusKey({
    status: r.status,
    connectivity: entry.connectivity,
    pending: r.pending.length,
    blocked: entry.lastReport?.blocked,
  });
  const unread = unreadNotices(state, state.members[r.memberId], r.noticeMarks).length;
  const bell = <BellButton testID="notifications-open" count={unread} label={t("notifications")} onPress={() => router.push({ pathname: "/c/[id]/notifications", params: { id: entry.id } })} />;
  return (
    <Screen width="board" onRefresh={() => store.syncOne(entry.id)}>
      <Stack.Screen options={{ title: state.community.name }} />
      {/* The bell and the sync status share the first row, on every platform and in Storybook alike. */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.s }}>
        {bell}
        <SyncStatus status={sync} />
      </View>
      {entry.unseenRejections.map((x, i) => (
        <Banner key={i} animated tone="danger" text={`${t("rejectedChange")}: ${t(reasonKey(x.reason))}`} />
      ))}
      {state.community.whatsapp ? (
        <Actions>
          <WhatsAppButton testID="community-whatsapp-open" link={state.community.whatsapp} />
        </Actions>
      ) : null}
      <Segmented<Tab>
        value={tab}
        onChange={(v) => {
          setTab(v);
          store.clearRejections(entry.id);
        }}
        options={[
          { value: "events", label: t("tabEvents") },
          { value: "tasks", label: t("tabTasks"), badge: newsFor(state, state.members[r.memberId], r.taskMarks).length },
          { value: "people", label: t("tabPeople") },
          { value: "me", label: t("tabMe") },
        ]}
      />
      <DisabledScope entry={entry}>
        {tab === "events" ? <EventsTab entry={entry} /> : tab === "tasks" ? <TasksTab entry={entry} /> : tab === "people" ? <PeopleTab entry={entry} /> : <MeTab entry={entry} />}
      </DisabledScope>
    </Screen>
  );
}
