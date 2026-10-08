import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useApp, useCommunity } from "../../../lib/context";
import { reasonKey } from "../../../model/i18n";
import { syncStatusKey } from "../../../model/sync-status";
import { EventsTab } from "../../../ui/community/EventsTab";
import { MeTab } from "../../../ui/community/MeTab";
import { PeopleTab } from "../../../ui/community/PeopleTab";
import { Banner, Body, Screen, Segmented, Title } from "../../../ui/kit";

type Tab = "events" | "people" | "me";

export default function Community() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, store } = useApp();
  const entry = useCommunity(id);
  const [tab, setTab] = useState<Tab>("events");

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

  const sync = syncStatusKey({ status: r.status, connectivity: entry.connectivity, pending: r.pending.length });
  return (
    <Screen>
      <Stack.Screen options={{ title: state.community.name }} />
      <Banner tone={sync.tone} text={t(sync.key)} />
      {entry.unseenRejections.map((x, i) => (
        <Banner key={i} tone="danger" text={`${t("rejectedChange")}: ${t(reasonKey(x.reason))}`} />
      ))}
      <Segmented<Tab>
        value={tab}
        onChange={(v) => {
          setTab(v);
          store.clearRejections(entry.id);
        }}
        options={[
          { value: "events", label: t("tabEvents") },
          { value: "people", label: t("tabPeople") },
          { value: "me", label: t("tabMe") },
        ]}
      />
      {tab === "events" ? <EventsTab entry={entry} /> : tab === "people" ? <PeopleTab entry={entry} /> : <MeTab entry={entry} />}
    </Screen>
  );
}
