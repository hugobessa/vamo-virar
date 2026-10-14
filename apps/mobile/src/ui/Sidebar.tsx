// The sidebar of the web app on a wide window: the communities this device
// belongs to, with what is waiting in each, and the app's other screens. The
// open community unfolds into its sections (the tab bar's routes), and, for
// the coordination and the moderation, the administration screen. The rows
// are real links, so they open in new tabs and show in the history.

import { Link, usePathname, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useApp } from "../lib/context";
import type { CommunityEntry } from "../lib/store";
import { attentionCount, noticeCount, taskNewsCount, toAnswerCount } from "../model/attention";
import { awaitingCount } from "../model/tasks";
import { useJoinRequests } from "./admin/hooks";
import { Eyebrow, FlagStripe, Wordmark } from "./brand";
import { CountBadge } from "./kit";
import { SIDEBAR_WIDTH } from "./layout";
import { fonts, radius, space, touch, useTheme } from "./theme";

function NavRow({ href, label, active, badge, testID, sub }: { href: Href; label: string; active: boolean; badge?: number; testID?: string; sub?: boolean }) {
  const c = useTheme();
  const [hover, setHover] = useState(false);
  // Plain style objects only: `Link asChild` drops a function style on the way to the anchor.
  const [pressed, setPressed] = useState(false);
  return (
    <Link href={href} asChild>
      <Pressable
        testID={testID}
        accessibilityRole="link"
        accessibilityLabel={badge ? `${label} (${badge})` : label}
        accessibilityState={{ selected: active }}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={{
          minHeight: sub ? touch - 8 : touch,
          flexDirection: "row",
          alignItems: "center",
          gap: space.s,
          paddingLeft: sub ? space.xl + space.m : space.m - 4,
          paddingRight: space.m,
          borderRadius: radius,
          borderLeftWidth: 4,
          borderLeftColor: active && !sub ? c.brand : "transparent",
          backgroundColor: active || pressed ? c.bg : hover ? c.chip : "transparent",
        }}
      >
        <Text numberOfLines={1} style={{ flex: 1, color: sub && !active ? c.muted : c.text, fontFamily: fonts.text, fontSize: sub ? 15 : 16, fontWeight: active ? "700" : "500" }}>
          {label}
        </Text>
        {badge ? <CountBadge n={badge} /> : null}
      </Pressable>
    </Link>
  );
}

/** The sections of the open community, under its row. */
function CommunitySections({ entry, pathname }: { entry: CommunityEntry; pathname: string }) {
  const { t } = useApp();
  const r = entry.replica;
  const view = r.view;
  const mod = r.status === "active" && r.canModerate;
  const { requests } = useJoinRequests(entry, mod);
  if (!view || r.status !== "active") return null;
  const base = `/c/${entry.id}`;
  const news = taskNewsCount(view, r.memberId, r.taskMarks, true);
  const pending = (requests?.length ?? 0) + (mod ? r.reports.length : 0);
  const row = (name: string, label: string, badge?: number) => (
    <NavRow
      key={name}
      sub
      testID={`sidebar-${entry.id}-${name}`}
      href={{ pathname: name ? `/c/[id]/${name}` : "/c/[id]", params: { id: entry.id } } as Href}
      label={label}
      badge={badge}
      active={pathname === (name ? `${base}/${name}` : base)}
    />
  );
  return (
    <>
      {row("", t("tabEvents"), toAnswerCount(view, r.memberId, r.incomingProbes.length))}
      {row("tasks", t("tabTasks"), news || awaitingCount(view) || undefined)}
      {row("people", t("tabPeople"))}
      {row("me", t("tabMe"))}
      {row("notifications", t("notifications"), noticeCount(view, r.memberId, r.noticeMarks, true) || undefined)}
      {mod ? row("admin", t("adminTitle"), pending) : null}
    </>
  );
}

export function Sidebar() {
  const { store, t } = useApp();
  const c = useTheme();
  const pathname = usePathname();
  const communities = store.ready ? store.list() : [];
  const at = (path: string) => pathname === path;
  return (
    <View testID="sidebar" style={{ width: SIDEBAR_WIDTH, backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.border }}>
      <FlagStripe height={4} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space.l, gap: space.xs }}>
        <Link href="/" asChild>
          <Pressable accessibilityRole="link" accessibilityLabel={t("appName")} style={{ alignSelf: "flex-start", marginBottom: space.l }}>
            <Wordmark size="sm" />
          </Pressable>
        </Link>
        <View style={{ paddingHorizontal: space.m, marginBottom: space.xs }}>
          <Eyebrow>{t("yourCommunities")}</Eyebrow>
        </View>
        {communities.map((e) => {
          const r = e.replica;
          const open = at(`/c/${e.id}`) || pathname.startsWith(`/c/${e.id}/`);
          const waiting = attentionCount(r.view, r.memberId, r.incomingProbes.length, r.taskMarks, r.noticeMarks, r.status === "active");
          return (
            <View key={e.id}>
              <NavRow
                testID={`sidebar-${e.id}`}
                href={{ pathname: "/c/[id]", params: { id: e.id } }}
                label={r.view?.community.name ?? t("waitingTitle")}
                badge={open ? undefined : waiting}
                active={open}
              />
              {open ? <CommunitySections entry={e} pathname={pathname} /> : null}
            </View>
          );
        })}
        <NavRow href="/create" label={t("createCommunity")} active={at("/create")} />
        <NavRow href="/join" label={t("joinCommunity")} active={at("/join")} />
        {communities.length === 0 ? <NavRow href="/link" label={t("linkHaveOther")} active={at("/link")} /> : null}
        <View style={{ flex: 1, minHeight: space.xl }} />
        {communities.length > 0 ? <NavRow href="/devices" label={t("devicesTitle")} active={at("/devices") || at("/link-offer")} /> : null}
        <NavRow href="/settings" label={t("calendarsTitle")} active={at("/settings")} />
        <NavRow href="/safety" label={t("safetyTitle")} active={at("/safety")} />
      </ScrollView>
    </View>
  );
}
