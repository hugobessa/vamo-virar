// A community is four sections in a bottom tab bar: its actions, its tasks,
// its people and this person. The header above them belongs to the stack:
// the community's name, and, for the coordination and the moderation, the
// way into the administration. On a wide web window the sidebar lists the
// sections, so the bar stays out of the way.

import { router, Stack, Tabs, useLocalSearchParams } from "expo-router";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useApp, useCommunity } from "../../../../lib/context";
import { noticeCount, taskNewsCount, toAnswerCount } from "../../../../model/attention";
import { AdminButton, useAdminPending } from "../../../../ui/community/AdminButton";
import { TAB_KEYS, TabBar, type TabKey } from "../../../../ui/community/TabBar";
import { BellButton } from "../../../../ui/kit";
import { useLayout } from "../../../../ui/layout";
import { space } from "../../../../ui/theme";

type BarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

export default function CommunityLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, store } = useApp();
  const l = useLayout();
  const entry = useCommunity(id);
  const r = entry?.replica;
  const state = r?.view;
  const { mod, pending } = useAdminPending(entry);
  const active = r?.status === "active" && !!state;

  const labels: Record<TabKey, string> = { index: t("tabEvents"), tasks: t("tabTasks"), people: t("tabPeople"), me: t("tabMe") };
  const badges: Partial<Record<TabKey, number>> =
    r && state && active
      ? { index: toAnswerCount(state, r.memberId, r.incomingProbes.length), tasks: taskNewsCount(state, r.memberId, r.taskMarks, true) }
      : {};

  const bar = (p: BarProps) => {
    // The sidebar lists the sections on a wide web window; before the community is in, there is nothing to switch between.
    if (l.sidebar || !active) return null;
    const current = p.state.routes[p.state.index]?.name;
    return (
      <TabBar
        items={TAB_KEYS.map((key) => ({ key, label: labels[key], badge: badges[key], active: current === key, testID: `tab-${key}` }))}
        onPress={(key) => {
          const route = p.state.routes.find((x) => x.name === key);
          if (!route) return;
          const event = p.navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          // A section not opened yet has no params of its own: the community's id comes from this layout's segment.
          if (!event.defaultPrevented) p.navigation.navigate(route.name, { ...(route.params as object | undefined), id });
          // Leaving a section is enough to have seen the changes it refused.
          if (entry) store.clearRejections(entry.id);
        }}
      />
    );
  };

  const title = state?.community.name ?? t(r?.status === "rejected" ? "rejectedTitle" : "waitingTitle");
  // The header's right side: the notifications bell, and, for moderation on a phone, the administration (the sidebar lists it on a wide window).
  const unread = r && state && active ? noticeCount(state, r.memberId, r.noticeMarks, true) : 0;
  const headerRight =
    entry && active
      ? () => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <BellButton testID="notifications-open" count={unread} label={t("notifications")} onPress={() => router.push({ pathname: "/c/[id]/notifications", params: { id: entry.id } })} />
            {mod && !l.sidebar ? <AdminButton pending={pending} onPress={() => router.push({ pathname: "/c/[id]/admin", params: { id: entry.id } })} /> : null}
          </View>
        )
      : undefined;
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title, headerRight }} />
      <Tabs tabBar={bar} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }} backBehavior="initialRoute">
        <Tabs.Screen name="index" options={{ title: labels.index }} />
        <Tabs.Screen name="tasks" options={{ title: labels.tasks }} />
        <Tabs.Screen name="people" options={{ title: labels.people }} />
        <Tabs.Screen name="me" options={{ title: labels.me }} />
      </Tabs>
    </View>
  );
}
