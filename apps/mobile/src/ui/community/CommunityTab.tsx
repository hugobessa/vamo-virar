// What every section of a community shares: the community from the route,
// the states before it is joined, the sync status and the rejected changes
// on top, and the read-only scope while it is marked for deletion. Each tab
// route renders its section through this.

import { useLocalSearchParams } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useApp, useCommunity } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { reasonKey } from "../../model/i18n";
import { syncStatusKey } from "../../model/sync-status";
import { Banner, Body, Screen, Title } from "../kit";
import { fonts, space, useTheme } from "../theme";
import { DisabledScope } from "./Disabled";

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

export function CommunityTab({ children, width = "board" }: { children: (entry: CommunityEntry) => ReactNode; width?: "board" | "reading" }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, store } = useApp();
  const entry = useCommunity(id);

  useEffect(() => {
    if (id) void store.syncOne(id);
  }, [id, store]);

  if (!entry) return <Screen bottomInset={false}><Body>…</Body></Screen>;
  const r = entry.replica;
  const state = r.view;

  if (r.status === "joining" || r.status === "rejected" || !state) {
    const rejected = r.status === "rejected";
    return (
      <Screen bottomInset={false}>
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
  return (
    <Screen width={width} bottomInset={false} onRefresh={() => store.syncOne(entry.id)}>
      <SyncStatus status={sync} />
      {entry.unseenRejections.map((x, i) => (
        <Banner key={i} animated tone="danger" text={`${t("rejectedChange")}: ${t(reasonKey(x.reason))}`} />
      ))}
      <DisabledScope entry={entry}>{children(entry)}</DisabledScope>
    </Screen>
  );
}
