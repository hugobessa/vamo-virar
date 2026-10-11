// Small pieces shared by the board, the task screen and the form: status and
// priority chips, the due-date line, a row of choices, and a task card.

import type { CommunityState, Task, TaskPriority, TaskStatus } from "@vamo-virar/domain";
import { useContext, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useApp } from "../../lib/context";
import { isOverdue, PRIORITY_TEXT, scopeTitle, STATUS_TEXT } from "../../model/tasks";
import { Card, Chip, ReadOnly, type ChipTone } from "../kit";
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

export function DueLine({ task, now }: { task: Task; now: number }) {
  const { t, locale } = useApp();
  const c = useTheme();
  if (task.due_at === undefined) return null;
  const late = isOverdue(task, now);
  const date = new Date(task.due_at).toLocaleDateString(locale, { day: "numeric", month: "short" });
  return (
    <Text style={{ color: late ? c.danger : c.muted, fontFamily: fonts.text, fontSize: 14, fontWeight: late ? "700" : "400" }}>
      {late ? `${t("taskOverdue")} · ${date}` : `${t("taskDue_")}: ${date}`}
    </Text>
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

/** A horizontal row of pill choices, one selected. `null` value = the "any" option. */
export function Choices<T extends string | null>({
  options,
  value,
  onChange,
  testID,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
}) {
  const c = useTheme();
  const readOnly = useContext(ReadOnly);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingVertical: 2 }}>
      {options.map((o) => {
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
      })}
    </ScrollView>
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
export function TaskCard({ task, state, now, onPress, showScope = true, index = 0 }: { task: Task; state: CommunityState; now: number; onPress: () => void; showScope?: boolean; index?: number }) {
  const { t } = useApp();
  const c = useTheme();
  const scope = showScope ? scopeTitle(state, task) : undefined;
  const who = task.assignee !== undefined ? nameOf(state, task.assignee, "?") : null;
  return (
    <Card testID={`task-${task.task_id}`} onPress={onPress} accent={task.status === "awaiting_volunteer"}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.s }}>
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
      <Tags tags={task.tags} />
      {index < 0 ? null : null}
    </Card>
  );
}
