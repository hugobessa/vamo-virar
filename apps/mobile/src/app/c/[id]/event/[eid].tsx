import { canModerate } from "@vamo-virar/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { confirm } from "../../../../lib/confirm";
import { useApp, useCommunity, useNow } from "../../../../lib/context";
import {
  ACTION_TEXT,
  byStatus,
  canManage,
  confirmedCount,
  invitable,
  orgActionsFor,
  selfActions,
  STATUS_TEXT,
  statusOf,
  type OrgAction,
} from "../../../../model/events";
import { fill } from "../../../../model/i18n";
import { tasksOfEvent } from "../../../../model/tasks";
import { formatWhen } from "../../../../model/time";
import { TaskCard } from "../../../../ui/tasks/TaskBits";
import { AvailabilityChip } from "../../../../ui/AvailabilityChip";
import { EventMap } from "../../../../ui/EventMap";
import { StarBurst } from "../../../../ui/brand";
import { ProbeQuestion, ProbeResults } from "../../../../ui/ProbeSections";
import { DisabledScope } from "../../../../ui/community/Disabled";
import { Actions, Body, Button, Card, Chip, Columns, Enter, Heading, Progress, Screen, Title } from "../../../../ui/kit";
import { space } from "../../../../ui/theme";
import { WhatsAppButton, WhatsAppEditor } from "../../../../ui/WhatsApp";

export default function EventScreen() {
  const { id, eid } = useLocalSearchParams<{ id: string; eid: string }>();
  const { t, store, locale } = useApp();
  const now = useNow();
  const entry = useCommunity(id);
  const [inviting, setInviting] = useState(false);
  // null: not edited yet, show what is recorded.
  const [attendedEdit, setAttended] = useState<Set<string> | null>(null);
  const state = entry?.replica.view;
  const ev = state?.events[eid ?? ""];
  const meRec = entry && state ? state.members[entry.replica.memberId] : undefined;
  const moderate = !!state && !!meRec && canModerate(state, meRec);
  const mine = ev && entry ? statusOf(ev, entry.replica.memberId) : "none";
  // Stars fly when this person becomes confirmed, whoever confirmed it.
  const [burst, setBurst] = useState(0);
  const wasConfirmed = useRef(mine === "confirmed");
  useEffect(() => {
    if (mine === "confirmed" && !wasConfirmed.current) setBurst((n) => n + 1);
    wasConfirmed.current = mine === "confirmed";
  }, [mine]);
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
            {entry ? <DisabledScope entry={entry}>{removeButton(summary.event_id)}</DisabledScope> : null}
          </>
        ) : (
          <Body muted>{t("why_unknown_target")}</Body>
        )}
      </Screen>
    );
  }
  const r = entry.replica;
  const me = state.members[r.memberId];
  const manage = canManage(state, ev, me);
  const confirmed = confirmedCount(ev);
  const submit = (type: string, body: Record<string, unknown>) => store.submit(entry.id, type, { event_id: ev.event_id, ...body } as never);

  const orgButtons = (memberId: string, only: OrgAction[]) =>
    orgActionsFor(state, ev, me, memberId)
      .filter((a) => only.includes(a))
      .map((a) => (
        <Button
          key={a}
          testID={`${a}-${memberId}`}
          kind={a === "approve" ? "primary" : "secondary"}
          haptic={a === "approve" ? "confirm" : undefined}
          label={t(ACTION_TEXT[a])}
          onPress={() => submit(`participation.${a}`, { member_id: memberId })}
        />
      ));

  const list = (label: Parameters<typeof t>[0], people: ReturnType<typeof byStatus>, actions: OrgAction[]) =>
    people.length === 0 ? null : (
      <>
        <Heading>{t(label)}</Heading>
        {people.map((m, i) => (
          <Enter key={m.member_id} delay={i * space.xs * 10}>
            <Card>
              <Body>{m.profile?.display_name ?? "?"}</Body>
              <View style={{ gap: space.s }}>{orgButtons(m.member_id, actions)}</View>
            </Card>
          </Enter>
        ))}
      </>
    );

  const self = selfActions(state, ev, me);
  // The action's own to-do list: open tasks first; managers add more here.
  const tasks = tasksOfEvent(state, ev.event_id, me).filter((x) => x.status !== "done" && x.status !== "cancelled");
  const showTasks = tasks.length > 0 || (manage && ev.status === "scheduled");

  // What the action is and what this person does about it.
  const main = (
    <>
      <Title>{ev.title}</Title>
      <Body>{formatWhen(ev.starts_at, ev.ends_at, locale, ev.tz)}</Body>
      <Body muted>{ev.location.label}</Body>
      {/* The exact point is for organizers and confirmed people; others see the cell around it (§9.6). */}
      <EventMap testID="event-map" area={ev.location.area} approximate={!manage && mine !== "confirmed" && mine !== "reconfirm"} radiusM={ev.location.radius_m} />
      {ev.description ? <Body>{ev.description}</Body> : null}
      {ev.status === "scheduled" && ev.capacity !== undefined ? (
        <Progress
          value={confirmed}
          max={ev.capacity}
          tone={confirmed >= ev.capacity ? "warn" : "ok"}
          label={`${fill(t("confirmedProgress"), { n: confirmed, cap: ev.capacity })}${confirmed < ev.capacity ? ` · ${fill(t("remaining"), { n: ev.capacity - confirmed })}` : ""}`}
        />
      ) : null}
      {ev.whatsapp ? (
        <Actions>
          <WhatsAppButton testID="event-whatsapp-open" link={ev.whatsapp} />
        </Actions>
      ) : null}
      {ev.status !== "scheduled" ? <Chip label={t(ev.status === "cancelled" ? "cancelled" : "completed")} tone={ev.status === "cancelled" ? "danger" : "neutral"} /> : null}
      <StarBurst trigger={burst} />
      {mine !== "none" ? <Chip label={t(STATUS_TEXT[mine])} tone={mine === "confirmed" ? "ok" : "warn"} /> : null}
      {ev.status === "scheduled" ? <AvailabilityChip ev={ev} /> : null}

      <ProbeQuestion entry={entry} ev={ev} />
      {self.length > 0 ? (
        <Actions>
          {self.map((a, i) => (
            <Button
              key={a}
              testID={`self-${a}`}
              kind={i === 0 ? "primary" : "secondary"}
              haptic={a === "accept" || a === "volunteer" ? "confirm" : "light"}
              label={t(ACTION_TEXT[a])}
              onPress={() => submit(`participation.${a}`, {})}
            />
          ))}
        </Actions>
      ) : null}

      {showTasks ? (
        <>
          <Heading>{t("taskEventSection")}</Heading>
          {tasks.slice(0, 5).map((task, i) => (
            <Enter key={task.task_id} delay={i * 40}>
              <TaskCard task={task} state={state} now={now} showScope={false} onPress={() => router.push({ pathname: "/c/[id]/task/[tid]", params: { id: entry.id, tid: task.task_id } })} />
            </Enter>
          ))}
          <View style={{ flexDirection: "row", gap: space.s }}>
            {manage && ev.status === "scheduled" ? (
              <View style={{ flex: 1 }}>
                <Button testID="event-new-task" kind="secondary" label={t("newTask")} onPress={() => router.push({ pathname: "/c/[id]/task-form", params: { id: entry.id, eid: ev.event_id } })} />
              </View>
            ) : null}
            {tasks.length > 0 ? (
              <View style={{ flex: 1 }}>
                <Button kind="secondary" label={t("taskSeeBoard")} allowReadOnly onPress={() => router.push({ pathname: "/c/[id]/tasks", params: { id: entry.id } })} />
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </>
  );

  // Who is coming, and the organizers' tools.
  const aside = (
    <>
      {list("confirmedList", byStatus(state, ev, ["confirmed", "reconfirm"]), [])}
      {list("volunteersList", byStatus(state, ev, ["volunteered"]), ["approve", "reject"])}
      {list("invitedList", byStatus(state, ev, ["invited"]), ["revoke"])}

      {manage && ev.status === "scheduled" ? (
        <>
          <ProbeResults entry={entry} ev={ev} />
          <WhatsAppEditor
            key={ev.whatsapp ?? ""}
            testID="event-whatsapp-editor"
            title={t("whatsappEventTitle")}
            current={ev.whatsapp}
            onSave={(link) => submit("event.update", { whatsapp: link })}
          />
          <Button testID="toggle-invite" kind="secondary" label={t("inviteSomeone")} onPress={() => setInviting(!inviting)} />
          {inviting
            ? invitable(state, ev).map((m, i) => (
                <Enter key={m.member_id} delay={i * 40}>
                  <Card>
                    <Body>{m.profile?.display_name ?? "?"}</Body>
                    {orgButtons(m.member_id, ["invite"])}
                  </Card>
                </Enter>
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
                haptic="light"
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
    </>
  );

  return (
    <Screen width="board">
      <Stack.Screen options={{ title: ev.title }} />
      <DisabledScope entry={entry}>
        <Columns main={main} aside={aside} />
      </DisabledScope>
    </Screen>
  );
}
