// The task board: everything this person may see, grouped by status, with
// filters by action, tag and "mine". Managers add tasks from here.

import { canModerate, type TaskStatus } from "@vamo-virar/domain";
import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useApp, useNow } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { canManage as canManageEvent } from "../../model/events";
import { allTags, awaitingCount, byStatus, STATUS_TEXT, visibleTasks, type TaskFilter } from "../../model/tasks";
import { Body, Button, EmptyState, Enter, Segmented } from "../kit";
import { fonts, motion, space, useTheme } from "../theme";
import { Choices, TaskCard } from "../tasks/TaskBits";

type Quick = "all" | "mine" | "pool";

export function TasksTab({ entry }: { entry: CommunityEntry }) {
  const { t } = useApp();
  const c = useTheme();
  const now = useNow();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const [quick, setQuick] = useState<Quick>("all");
  const [scope, setScope] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  // Who may create: moderation anywhere, organizers inside actions they run.
  const mod = !!me && canModerate(state, me);
  const myEvents = Object.values(state.events)
    .filter((ev) => ev.status === "scheduled" && !!me && canManageEvent(state, ev, me))
    .sort((a, b) => a.starts_at - b.starts_at);
  const mayCreate = mod || myEvents.length > 0;
  const newTask = () => router.push({ pathname: "/c/[id]/task-form", params: { id: entry.id, ...(scope && scope !== "community" ? { eid: scope } : {}) } });

  const filter: TaskFilter = {
    ...(scope ? { scope } : {}),
    ...(tag ? { tag } : {}),
    ...(quick === "mine" ? { mine: true } : quick === "pool" ? { status: "awaiting_volunteer" as TaskStatus } : {}),
  };
  const tasks = visibleTasks(state, me, filter);
  const all = visibleTasks(state, me);
  const scopes = new Map<string, string>();
  for (const task of all) {
    const key = task.event_id ?? "community";
    const title = task.event_id === undefined ? t("taskScopeCommunity") : (state.events[task.event_id]?.title ?? state.event_summaries[task.event_id]?.title ?? "?");
    scopes.set(key, title);
  }
  const tags = allTags(state);
  const pool = awaitingCount(state);
  let index = 0;

  return (
    <>
      {mayCreate && all.length > 0 ? <Button testID="new-task" label={t("newTask")} onPress={newTask} /> : null}
      {all.length === 0 ? (
        <EmptyState
          testID="no-tasks"
          title={t("noTasks")}
          body={mayCreate ? t("noTasksBody") : t("noTasksMember")}
          action={mayCreate ? t("noTasksCta") : undefined}
          actionTestID="new-task"
          onAction={mayCreate ? newTask : undefined}
        />
      ) : (
        <>
          <Segmented<Quick>
            value={quick}
            onChange={setQuick}
            options={[
              { value: "all", label: t("taskFilterAll") },
              { value: "mine", label: t("taskFilterMine") },
              { value: "pool", label: pool > 0 ? `${t("taskFilterPool")} (${pool})` : t("taskFilterPool") },
            ]}
          />
          {scopes.size > 1 ? (
            <Choices<string | null>
              testID="scope"
              value={scope}
              onChange={setScope}
              options={[{ value: null, label: t("taskFilterAll") }, ...[...scopes.entries()].map(([value, label]) => ({ value, label }))]}
            />
          ) : null}
          {tags.length > 0 ? (
            <Choices<string | null> testID="tag" value={tag} onChange={setTag} options={[{ value: null, label: t("taskFilterTag") }, ...tags.map((x) => ({ value: x, label: `#${x}` }))]} />
          ) : null}
          {tasks.length === 0 ? <Body muted>{t("noTasks")}</Body> : null}
          {byStatus(tasks).map((g) => (
            <View key={g.status} style={{ gap: space.m }}>
              <Text style={{ color: c.muted, fontFamily: fonts.display, fontSize: 12, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" }}>
                {`${t(STATUS_TEXT[g.status])} · ${g.tasks.length}`}
              </Text>
              {g.tasks.map((task) => (
                <Enter key={task.task_id} delay={Math.min(index++, 6) * motion.stagger}>
                  <TaskCard task={task} state={state} now={now} onPress={() => router.push({ pathname: "/c/[id]/task/[tid]", params: { id: entry.id, tid: task.task_id } })} />
                </Enter>
              ))}
            </View>
          ))}
        </>
      )}
    </>
  );
}
