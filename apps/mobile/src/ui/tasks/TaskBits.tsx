// Small pieces shared by the board, the task screen and the form: status and
// priority chips, the due-date line, a row of choices, and a task card.

import type { CommunityState, MemberRecord, Task, TaskPriority, TaskStatus } from "@vamo-virar/domain";
import { useContext, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useApp } from "../../lib/context";
import { fill } from "../../model/i18n";
import { checklistProgress } from "../../model/markdown";
import { dueLabel, PRIORITY_TEXT, scopeTitle, STATUS_TEXT } from "../../model/tasks";
import { Body, Card, Chip, Field, ReadOnly, Sheet, type ChipTone } from "../kit";
import { fonts, radius, space, touch, useTheme } from "../theme";

export const STATUS_TONE: Record<TaskStatus, ChipTone> = {
  awaiting_volunteer: "warn",
  todo: "neutral",
  in_progress: "ok",
  blocked: "danger",
  done: "ok",
  cancelled: "neutral",
};

export function StatusChip({ status }: { status: TaskStatus }) {
  const { t } = useApp();
  return <Chip label={t(STATUS_TEXT[status])} tone={STATUS_TONE[status]} />;
}

/** Shown only when the priority says something: normal is the quiet default. */
export function PriorityChip({ priority }: { priority: TaskPriority }) {
  const { t } = useApp();
  if (priority === "normal") return null;
  return <Chip label={t(PRIORITY_TEXT[priority])} tone={priority === "urgent" ? "danger" : priority === "high" ? "warn" : "neutral"} />;
}

/** "Prazo em 5 dias · 16 de out.": relative first, the date after. Late is red, today and tomorrow amber. */
export function DueLine({ task, now }: { task: Task; now: number }) {
  const { t, locale } = useApp();
  const c = useTheme();
  const due = dueLabel(task, now);
  if (!due || task.due_at === undefined) return null;
  const date = new Date(task.due_at).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const words = due.key === "taskDue_" ? `${t("taskDue_")}: ${date}` : `${fill(t(due.key), { n: due.n })} · ${date}`;
  return (
    <Text style={{ color: due.late ? c.danger : due.soon ? c.warn : c.muted, fontFamily: fonts.text, fontSize: 14, fontWeight: due.late || due.soon ? "700" : "400" }}>
      {words}
    </Text>
  );
}

/** "1 de 3 itens feitos", with a thin bar; nothing when the description has no check boxes. */
export function ChecklistProgress({ source }: { source: string }) {
  const { t } = useApp();
  const c = useTheme();
  const { done, total } = checklistProgress(source);
  if (total === 0) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
      <View style={{ width: 56, height: 6, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" }}>
        <View style={{ width: `${(done / total) * 100}%`, height: "100%", backgroundColor: c.ok }} />
      </View>
      <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 14 }}>{fill(t("taskChecklist"), { done, total })}</Text>
    </View>
  );
}

export function Tags({ tags }: { tags: readonly string[] }) {
  const c = useTheme();
  if (tags.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
      {tags.map((tag) => (
        <View key={tag} style={{ borderRadius: 999, borderWidth: 1, borderColor: c.border, paddingHorizontal: space.s, paddingVertical: 2 }}>
          <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 13 }}>#{tag}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Pill choices, one selected. `null` value = the "any" option. They wrap onto
 * more lines, so nothing hides past the edge; `scroll` keeps one sliding row.
 */
export function Choices<T extends string | null>({
  options,
  value,
  onChange,
  testID,
  scroll,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
  scroll?: boolean;
}) {
  const c = useTheme();
  const readOnly = useContext(ReadOnly);
  const pills = options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            testID={testID ? `${testID}-${o.value ?? "any"}` : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: readOnly }}
            disabled={readOnly}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({
              minHeight: touch - 12,
              paddingHorizontal: space.m,
              justifyContent: "center",
              borderRadius: radius,
              borderWidth: 1,
              borderColor: on ? c.primary : c.border,
              backgroundColor: on ? c.primary : c.surface,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <Text style={{ color: on ? c.primaryText : c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{o.label}</Text>
          </Pressable>
        );
      });
  return scroll ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingVertical: 2 }}>
      {pills}
    </ScrollView>
  ) : (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>{pills}</View>
  );
}

/** A sheet listing people to pick one, with a search box when the list is long. `none` adds a "nobody" row on top. */
export function PeopleSheet({
  visible,
  onClose,
  title,
  people,
  value,
  onPick,
  me,
  none,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  people: MemberRecord[];
  value: string | null;
  onPick: (v: string | null) => void;
  me?: string;
  none?: string;
  testID?: string;
}) {
  const { t } = useApp();
  const c = useTheme();
  const [q, setQ] = useState("");
  const query = q.trim().toLocaleLowerCase();
  const shown = people.filter((m) => !query || (m.profile?.display_name ?? "").toLocaleLowerCase().includes(query));
  const pick = (v: string | null) => {
    onPick(v);
    setQ("");
  };
  const row = (key: string, text: string, on: boolean, v: string | null, id?: string) => (
    <Pressable
      key={key}
      testID={id}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={() => pick(v)}
      style={({ pressed }) => ({ minHeight: touch, flexDirection: "row", alignItems: "center", gap: space.m, paddingHorizontal: space.m, borderRadius: radius, backgroundColor: on || pressed ? c.surface : "transparent" })}
    >
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? c.primary : c.border, alignItems: "center", justifyContent: "center" }}>
        {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary }} /> : null}
      </View>
      <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 17, fontWeight: on ? "700" : "500" }}>{text}</Text>
    </Pressable>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID={testID}>
      {people.length > 6 ? <Field testID={testID ? `${testID}-search` : undefined} label={t("taskPeopleSearch")} value={q} onChangeText={setQ} autoCapitalize="none" /> : null}
      <View style={{ gap: 2 }}>
        {none && !query ? row("none", none, value === null, null, testID ? `${testID}-none` : undefined) : null}
        {shown.map((m) => row(m.member_id, personName(m, me, t("taskYou")), value === m.member_id, m.member_id, testID ? `${testID}-${m.member_id}` : undefined))}
        {shown.length === 0 ? <Body muted>{t("taskNoPeopleMatch")}</Body> : null}
      </View>
    </Sheet>
  );
}

function personName(m: MemberRecord, me: string | undefined, you: string): string {
  const name = m.profile?.display_name ?? "?";
  return m.member_id === me ? `${name} (${you})` : name;
}

/** Picks one person from the community: the current choice as a field that opens a PeopleSheet. */
export function PersonPicker({
  people,
  value,
  onChange,
  me,
  none,
  label,
  testID,
}: {
  people: MemberRecord[];
  value: string | null;
  onChange: (v: string | null) => void;
  me?: string;
  none?: string;
  label: string;
  testID?: string;
}) {
  const { t } = useApp();
  const c = useTheme();
  const readOnly = useContext(ReadOnly);
  const [open, setOpen] = useState(false);
  const chosen = value === null ? undefined : people.find((m) => m.member_id === value);
  const text = chosen ? personName(chosen, me, t("taskYou")) : (none ?? "");
  return (
    <View style={{ gap: space.xs }}>
      <Label>{label}</Label>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${text}`}
        accessibilityState={{ disabled: readOnly }}
        disabled={readOnly}
        onPress={() => setOpen(true)}
        style={{ minHeight: touch, borderRadius: radius, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, paddingHorizontal: space.m, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.s }}
      >
        <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 17 }}>{text}</Text>
        <Text style={{ color: c.primary, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{t("taskAssigneePick")}</Text>
      </Pressable>
      <PeopleSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={label}
        people={people}
        value={value}
        me={me}
        none={none}
        testID={testID ? `${testID}-sheet` : undefined}
        onPick={(v) => {
          onChange(v);
          setOpen(false);
        }}
      />
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{children}</Text>;
}

export function nameOf(state: CommunityState, memberId: string | undefined, fallback: string): string {
  return memberId === undefined ? fallback : (state.members[memberId]?.profile?.display_name ?? fallback);
}

/** One task on a list: what, where, who, when. */
export function TaskCard({ task, state, now, onPress, showScope = true, isNew }: { task: Task; state: CommunityState; now: number; onPress: () => void; showScope?: boolean; isNew?: boolean }) {
  const { t } = useApp();
  const c = useTheme();
  const scope = showScope ? scopeTitle(state, task) : undefined;
  const who = task.assignee !== undefined ? nameOf(state, task.assignee, "?") : null;
  return (
    <Card testID={`task-${task.task_id}`} onPress={onPress} accent={task.status === "awaiting_volunteer"}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.s }}>
        {isNew ? <View accessibilityLabel={t("taskNewChip")} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.brand, marginTop: 7 }} /> : null}
        <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 17, fontWeight: "700", lineHeight: 24 }}>{task.title}</Text>
        <PriorityChip priority={task.priority} />
      </View>
      {scope ? <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 14 }}>{scope}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s }}>
        <StatusChip status={task.status} />
        <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 14 }}>
          {who ?? t("taskNobodyYet")}
          {task.volunteers.length > 0 ? ` +${task.volunteers.length}` : ""}
        </Text>
      </View>
      <DueLine task={task} now={now} />
      <ChecklistProgress source={task.description} />
      <Tags tags={task.tags} />
    </Card>
  );
}
