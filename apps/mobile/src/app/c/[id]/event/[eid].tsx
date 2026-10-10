import { canModerate } from "@vamo-virar/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { confirm } from "../../../../lib/confirm";
import { useApp, useCommunity } from "../../../../lib/context";
import {
  ACTION_TEXT,
  byStatus,
  canManage,
  invitable,
  orgActionsFor,
  selfActions,
  STATUS_TEXT,
  statusOf,
  type OrgAction,
} from "../../../../model/events";
import { formatWhen } from "../../../../model/time";
import { AvailabilityChip } from "../../../../ui/AvailabilityChip";
import { ProbeQuestion, ProbeResults } from "../../../../ui/ProbeSections";
import { Body, Button, Card, Chip, Heading, Screen, Title } from "../../../../ui/kit";
import { space } from "../../../../ui/theme";

export default function EventScreen() {
  const { id, eid } = useLocalSearchParams<{ id: string; eid: string }>();
  const { t, store, locale } = useApp();
  const entry = useCommunity(id);
  const [inviting, setInviting] = useState(false);
  // null: not edited yet, show what is recorded.
  const [attendedEdit, setAttended] = useState<Set<string> | null>(null);
  const state = entry?.replica.view;
  const ev = state?.events[eid ?? ""];
  const meRec = entry && state ? state.members[entry.replica.memberId] : undefined;
  const moderate = !!state && !!meRec && canModerate(state, meRec);
  // Moderation: deletes the event for everyone, details and history included.
  const removeButton = (eventId: string) =>
    moderate && entry ? (
      <Button
        testID="remove-event"
        kind="danger"
        label={t("removeEvent")}
        onPress={async () => {
          if (!(await confirm(t("removeEventConfirm"), t("yes"), t("no")))) return;
          store.submit(entry.id, "event.remove", { event_id: eventId });
          router.back();
        }}
      />
    ) : null;
  if (!entry || !state || !ev) {
    const summary = state?.event_summaries[eid ?? ""];
    return (
      <Screen>
        {summary ? (
          <>
            <Title>{summary.title}</Title>
            <Chip label={t(summary.status === "cancelled" ? "cancelled" : "completed")} />
            <Body muted>
              {summary.attended_count} / {summary.confirmed_count} {t("people")}
            </Body>
            {removeButton(summary.event_id)}
          </>
        ) : (
          <Body muted>{t("why_unknown_target")}</Body>
        )}
      </Screen>
    );
  }
  const r = entry.replica;
  const me = state.members[r.memberId];
  const mine = statusOf(ev, r.memberId);
  const manage = canManage(state, ev, me);
  const submit = (type: string, body: Record<string, unknown>) => store.submit(entry.id, type, { event_id: ev.event_id, ...body } as never);

  const orgButtons = (memberId: string, only: OrgAction[]) =>
    orgActionsFor(state, ev, me, memberId)
      .filter((a) => only.includes(a))
      .map((a) => (
        <Button
          key={a}
          testID={`${a}-${memberId}`}
          kind={a === "approve" ? "primary" : "secondary"}
          label={t(ACTION_TEXT[a])}
          onPress={() => submit(`participation.${a}`, { member_id: memberId })}
        />
      ));

  const list = (label: Parameters<typeof t>[0], people: ReturnType<typeof byStatus>, actions: OrgAction[]) =>
    people.length === 0 ? null : (
      <>
        <Heading>{t(label)}</Heading>
        {people.map((m) => (
          <Card key={m.member_id}>
            <Body>{m.profile?.display_name ?? "?"}</Body>
            <View style={{ gap: space.s }}>{orgButtons(m.member_id, actions)}</View>
          </Card>
        ))}
      </>
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: ev.title }} />
      <Title>{ev.title}</Title>
      <Body>{formatWhen(ev.starts_at, ev.ends_at, locale, ev.tz)}</Body>
      <Body muted>{ev.location.label}</Body>
      {ev.description ? <Body>{ev.description}</Body> : null}
      {ev.status !== "scheduled" ? <Chip label={t(ev.status === "cancelled" ? "cancelled" : "completed")} tone={ev.status === "cancelled" ? "danger" : "neutral"} /> : null}
      {mine !== "none" ? <Chip label={t(STATUS_TEXT[mine])} tone={mine === "confirmed" ? "ok" : "warn"} /> : null}
      {ev.status === "scheduled" ? <AvailabilityChip ev={ev} /> : null}

      <ProbeQuestion entry={entry} ev={ev} />
      {selfActions(state, ev, me).map((a, i) => (
        <Button key={a} testID={`self-${a}`} kind={i === 0 ? "primary" : "secondary"} label={t(ACTION_TEXT[a])} onPress={() => submit(`participation.${a}`, {})} />
      ))}

      {list("confirmedList", byStatus(state, ev, ["confirmed", "reconfirm"]), [])}
      {list("volunteersList", byStatus(state, ev, ["volunteered"]), ["approve", "reject"])}
      {list("invitedList", byStatus(state, ev, ["invited"]), ["revoke"])}

      {manage && ev.status === "scheduled" ? (
        <>
          <ProbeResults entry={entry} ev={ev} />
          <Button testID="toggle-invite" kind="secondary" label={t("inviteSomeone")} onPress={() => setInviting(!inviting)} />
          {inviting
            ? invitable(state, ev).map((m) => (
                <Card key={m.member_id}>
                  <Body>{m.profile?.display_name ?? "?"}</Body>
                  {orgButtons(m.member_id, ["invite"])}
                </Card>
              ))
            : null}
          <Button testID="complete-event" kind="secondary" label={t("completeEvent")} onPress={() => submit("event.complete", {})} />
          <Button
            kind="danger"
            label={t("cancelEvent")}
            onPress={async () => {
              if (await confirm(t("cancelEvent"), t("yes"), t("no"))) submit("event.cancel", {});
            }}
          />
        </>
      ) : null}

      {manage && ev.status === "completed" ? (
        <>
          <Heading>{t("recordAttendance")}</Heading>
          {byStatus(state, ev, ["confirmed"]).map((m) => {
            const attended = attendedEdit ?? new Set(ev.attended ?? []);
            const on = attended.has(m.member_id);
            return (
              <Button
                key={m.member_id}
                kind={on ? "primary" : "secondary"}
                label={`${on ? "✓ " : ""}${m.profile?.display_name ?? "?"}`}
                onPress={() => {
                  const next = new Set(attended);
                  if (next.has(m.member_id)) next.delete(m.member_id);
                  else next.add(m.member_id);
                  setAttended(next);
                }}
              />
            );
          })}
          <Button
            label={t("save")}
            disabled={attendedEdit === null}
            onPress={() => submit("event.attendance", { attended: [...(attendedEdit ?? [])] })}
          />
        </>
      ) : null}
      {removeButton(ev.event_id)}
    </Screen>
  );
}
