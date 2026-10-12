import { router } from "expo-router";
import { Text, View } from "react-native";
import { useApp, useNow } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { canOrganize, confirmedCount, past, STATUS_TEXT, statusOf, upcoming } from "../../model/events";
import { fill } from "../../model/i18n";
import { dateBlock, formatHours, groupByDay } from "../../model/time";
import { AvailabilityChip } from "../AvailabilityChip";
import { Actions, Body, Button, Card, Chip, EmptyState, Enter, Heading, Progress } from "../kit";
import { fonts, motion, space, useTheme } from "../theme";

export function EventsTab({ entry }: { entry: CommunityEntry }) {
  const { t, locale } = useApp();
  const c = useTheme();
  const now = useNow();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const next = upcoming(state, now);
  const before = past(state, now).slice(0, 20);
  const organizer = canOrganize(state, me);
  const newEvent = () => router.push({ pathname: "/c/[id]/new-event", params: { id: entry.id } });

  const card = (ev: (typeof next)[number], index: number) => {
    const st = statusOf(ev, r.memberId);
    const n = confirmedCount(ev);
    const when = dateBlock(ev.starts_at, now, locale, ev.tz, { today: t("today"), tomorrow: t("tomorrow") });
    const done = ev.status !== "scheduled";
    const mineChip =
      st !== "none" ? (
        <Chip label={t(STATUS_TEXT[st])} tone={st === "confirmed" ? "ok" : st === "invited" || st === "reconfirm" ? "warn" : "neutral"} />
      ) : null;
    return (
      <Enter key={ev.event_id} delay={Math.min(index, 6) * motion.stagger}>
        <Card testID={`event-${ev.event_id}`} onPress={() => router.push({ pathname: "/c/[id]/event/[eid]", params: { id: entry.id, eid: ev.event_id } })}>
          <View style={{ flexDirection: "row", gap: space.m }}>
            {/* Date block: the day number in the condensed face, the weekday under it. */}
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 52, alignItems: "center", opacity: done ? 0.5 : 1 }}>
              <Text style={{ color: c.brand, fontFamily: fonts.condensed, fontSize: 34, lineHeight: 36, fontWeight: "900" }}>{when.day}</Text>
              <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 }}>{when.weekday}</Text>
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.s }}>
                <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 17, fontWeight: "700", lineHeight: 24 }}>{ev.title}</Text>
                {ev.status === "cancelled" ? <Chip label={t("cancelled")} tone="danger" /> : ev.status === "completed" ? <Chip label={t("completed")} /> : mineChip}
              </View>
              <Body muted>{`${formatHours(ev.starts_at, ev.ends_at, locale, ev.tz)} · ${ev.location.label}`}</Body>
              {!done && ev.capacity !== undefined ? (
                <Progress
                  value={n}
                  max={ev.capacity}
                  tone={n >= ev.capacity ? "warn" : "ok"}
                  label={`${fill(t("confirmedProgress"), { n, cap: ev.capacity })}${n < ev.capacity ? ` · ${fill(t("remaining"), { n: ev.capacity - n })}` : ""}`}
                />
              ) : (
                <Body muted>{`${n} ${t("people")}`}</Body>
              )}
              {!done && st !== "confirmed" ? <AvailabilityChip ev={ev} compact /> : null}
            </View>
          </View>
        </Card>
      </Enter>
    );
  };

  let index = 0;
  return (
    <>
      {organizer && next.length > 0 ? (
        <Actions>
          <Button testID="new-event" label={t("newEvent")} onPress={newEvent} />
        </Actions>
      ) : null}
      <Heading>{t("upcoming")}</Heading>
      {next.length === 0 ? (
        <EmptyState
          testID="no-events"
          title={t("noEvents")}
          body={organizer ? t("noEventsBody") : undefined}
          action={organizer ? t("noEventsCta") : undefined}
          onAction={organizer ? newEvent : undefined}
          // The same test id as the "Nova ação" button above the list: the e2e creates the first action through it.
          actionTestID="new-event"
        />
      ) : (
        groupByDay(next).map((g) => {
          const when = dateBlock(g.first.starts_at, now, locale, g.first.tz, { today: t("today"), tomorrow: t("tomorrow") });
          return (
            <View key={g.key} style={{ gap: space.m }}>
              <Text style={{ color: c.muted, fontFamily: fonts.display, fontSize: 12, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" }}>{when.heading}</Text>
              {g.items.map((ev) => card(ev, index++))}
            </View>
          );
        })
      )}
      {before.length > 0 ? <Heading>{t("past")}</Heading> : null}
      {before.map((ev) => card(ev, index++))}
    </>
  );
}
