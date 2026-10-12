// The sidebar of the web app on a wide window: the communities this device
// belongs to, with what is waiting in each, and the app's other screens. The
// rows are real links, so they open in new tabs and show in the history.

import { Link, usePathname, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useApp } from "../lib/context";
import { taskNewsCount, toAnswerCount } from "../model/attention";
import { Eyebrow, FlagStripe, Wordmark } from "./brand";
import { CountBadge } from "./kit";
import { SIDEBAR_WIDTH } from "./layout";
import { fonts, radius, space, touch, useTheme } from "./theme";

function NavRow({ href, label, active, badge, testID }: { href: Href; label: string; active: boolean; badge?: number; testID?: string }) {
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
          minHeight: touch,
          flexDirection: "row",
          alignItems: "center",
          gap: space.s,
          paddingLeft: space.m - 4,
          paddingRight: space.m,
          borderRadius: radius,
          borderLeftWidth: 4,
          borderLeftColor: active ? c.brand : "transparent",
          backgroundColor: active || pressed ? c.bg : hover ? c.chip : "transparent",
        }}
      >
        <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 16, fontWeight: active ? "700" : "500" }}>
          {label}
        </Text>
        {badge ? <CountBadge n={badge} /> : null}
      </Pressable>
    </Link>
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
          const waiting = toAnswerCount(r.view, r.memberId, r.incomingProbes.length) + taskNewsCount(r.view, r.memberId, r.taskMarks, r.status === "active");
          return (
            <NavRow
              key={e.id}
              testID={`sidebar-${e.id}`}
              href={{ pathname: "/c/[id]", params: { id: e.id } }}
              label={r.view?.community.name ?? t("waitingTitle")}
              badge={waiting}
              active={at(`/c/${e.id}`) || pathname.startsWith(`/c/${e.id}/`)}
            />
          );
        })}
        <NavRow href="/create" label={t("createCommunity")} active={at("/create")} />
        <NavRow href="/join" label={t("joinCommunity")} active={at("/join")} />
        <View style={{ flex: 1, minHeight: space.xl }} />
        <NavRow href="/settings" label={t("calendarsTitle")} active={at("/settings")} />
        <NavRow href="/safety" label={t("safetyTitle")} active={at("/safety")} />
      </ScrollView>
    </View>
  );
}
