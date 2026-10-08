import { router } from "expo-router";
import { useApp, useNow } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { canOrganize, confirmedCount, past, STATUS_TEXT, statusOf, upcoming } from "../../model/events";
import { formatWhen } from "../../model/time";
import { AvailabilityChip } from "../AvailabilityChip";
import { Body, Button, Card, Chip, Heading } from "../kit";

export function EventsTab({ entry }: { entry: CommunityEntry }) {
  const { t, locale } = useApp();
  const now = useNow();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const next = upcoming(state, now);
  const before = past(state, now).slice(0, 20);

  const card = (ev: (typeof next)[number]) => {
    const st = statusOf(ev, r.memberId);
    const n = confirmedCount(ev);
    return (
      <Card
        key={ev.event_id}
        testID={`event-${ev.event_id}`}
        onPress={() => router.push({ pathname: "/c/[id]/event/[eid]", params: { id: entry.id, eid: ev.event_id } })}
      >
        <Body>{ev.title}</Body>
        <Body muted>{formatWhen(ev.starts_at, ev.ends_at, locale, ev.tz)}</Body>
        <Body muted>{ev.location.label}</Body>
        <Body muted>
          {n} {t("people")}
          {ev.capacity !== undefined ? ` · ${Math.max(0, ev.capacity - n)} ${t("spotsLeft")}` : ""}
        </Body>
        {ev.status === "scheduled" && st !== "confirmed" ? <AvailabilityChip ev={ev} /> : null}
        {ev.status === "cancelled" ? <Chip label={t("cancelled")} tone="danger" /> : null}
        {ev.status === "completed" ? <Chip label={t("completed")} /> : null}
        {st !== "none" ? <Chip label={t(STATUS_TEXT[st])} tone={st === "confirmed" ? "ok" : st === "invited" || st === "reconfirm" ? "warn" : "neutral"} /> : null}
      </Card>
    );
  };

  return (
    <>
      {canOrganize(state, me) ? (
        <Button testID="new-event" label={t("newEvent")} onPress={() => router.push({ pathname: "/c/[id]/new-event", params: { id: entry.id } })} />
      ) : null}
      <Heading>{t("upcoming")}</Heading>
      {next.length === 0 ? <Body muted>{t("noEvents")}</Body> : next.map(card)}
      {before.length > 0 ? <Heading>{t("past")}</Heading> : null}
      {before.map(card)}
    </>
  );
}
