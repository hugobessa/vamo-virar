// The task board: what changed since this person last looked, then
// everything they may see, grouped by status. One row of quick filters stays
// on screen; filtering by action and tag opens in a sheet, and the filters in
// use show as chips that remove themselves. Managers add tasks from here.

import { canModerate, type TaskStatus } from "@vamo-virar/domain";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useApp, useNow } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { canManage as canManageEvent } from "../../model/events";
import { fill } from "../../model/i18n";
import { allTags, awaitingCount, byStatus, lastSeq, NEWS_TEXT, newsFor, STATUS_TEXT, visibleTasks, type TaskFilter, type TaskNews } from "../../model/tasks";
import { Body, Button, Card, EmptyState, Enter, Segmented, Sheet } from "../kit";
import { fonts, motion, radius, space, touch, useTheme } from "../theme";
import { Choices, Label, nameOf, TaskCard } from "../tasks/TaskBits";

type Quick = "all" | "mine" | "pool";

/** A filter in use, as a chip that removes it. */
function FilterChip({ label, onRemove, testID }: { label: string; onRemove: () => void; testID?: string }) {
  const { t } = useApp();
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${t("taskFilterRemove")}: ${label}`}
      onPress={onRemove}
      style={({ pressed }) => ({ minHeight: touch - 12, flexDirection: "row", alignItems: "center", gap: space.s, paddingHorizontal: space.m, borderRadius: radius, backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 })}
    >
      <Text style={{ color: c.primaryText, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      <Text style={{ color: c.primaryText, fontSize: 15, fontWeight: "900" }}>✕</Text>
    </Pressable>
  );
}

function NewsCard({ news, entry, onPress }: { news: TaskNews; entry: CommunityEntry; onPress: () => void }) {
  const { t } = useApp();
  const c = useTheme();
  const state = entry.replica.view!;
  return (
    <Card accent onPress={onPress} testID={`news-${news.task.task_id}`}>
      <Text style={{ color: c.brand, fontFamily: fonts.text, fontSize: 14, fontWeight: "700" }}>{fill(t(NEWS_TEXT[news.reason]), { name: nameOf(state, news.by, "?") })}</Text>
      <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 17, fontWeight: "700", lineHeight: 24 }}>{news.task.title}</Text>
    </Card>
  );
}

export function TasksTab({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const c = useTheme();
  const now = useNow();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const [quick, setQuick] = useState<Quick>("all");
  const [scope, setScope] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);

  // Who may create: moderation anywhere, organizers inside actions they run.
  const mod = !!me && canModerate(state, me);
  const myEvents = Object.values(state.events)
    .filter((ev) => ev.status === "scheduled" && !!me && canManageEvent(state, ev, me))
    .sort((a, b) => a.starts_at - b.starts_at);
  const mayCreate = mod || myEvents.length > 0;
  const newTask = () => router.push({ pathname: "/c/[id]/task-form", params: { id: entry.id, ...(scope && scope !== "community" ? { eid: scope } : {}) } });
  const openTask = (tid: string) => router.push({ pathname: "/c/[id]/task/[tid]", params: { id: entry.id, tid } });

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
  const news = newsFor(state, me, r.taskMarks);
  const fresh = new Set(news.map((n) => n.task.task_id));
  const active = (scope ? 1 : 0) + (tag ? 1 : 0);
  const canFilter = scopes.size > 1 || tags.length > 0;
  let index = 0;

  return (
    <>
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
              { value: "pool", label: t("taskFilterPool"), badge: pool },
            ]}
          />
          {canFilter || mayCreate ? (
            <View style={{ flexDirection: "row", gap: space.s }}>
              {canFilter ? (
                <View style={{ flex: 1 }}>
                  <Button testID="open-filters" kind="secondary" compact allowReadOnly label={active ? fill(t("taskFiltersActive"), { n: active }) : t("taskFilters")} onPress={() => setFiltering(true)} />
                </View>
              ) : null}
              {mayCreate ? (
                <View style={{ flex: 1 }}>
                  <Button testID="new-task" compact label={`+ ${t("newTask")}`} onPress={newTask} />
                </View>
              ) : null}
            </View>
          ) : null}
          {active ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
              {scope ? <FilterChip testID="filter-scope" label={scopes.get(scope) ?? "?"} onRemove={() => setScope(null)} /> : null}
              {tag ? <FilterChip testID="filter-tag" label={`#${tag}`} onRemove={() => setTag(null)} /> : null}
            </View>
          ) : null}

          {news.length > 0 && quick === "all" && !active ? (
            <View style={{ gap: space.m }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: c.brand, fontFamily: fonts.display, fontSize: 12, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" }}>{`${t("taskNewsTitle")} · ${news.length}`}</Text>
                <Text
                  accessibilityRole="button"
                  testID="news-seen-all"
                  onPress={() => news.forEach((n) => store.markTaskSeen(entry.id, n.task.task_id, lastSeq(n.task)))}
                  style={{ color: c.primary, fontFamily: fonts.text, fontSize: 14, fontWeight: "700" }}
                >
                  {t("taskNewsSeenAll")}
                </Text>
              </View>
              {news.slice(0, 3).map((n, i) => (
                <Enter key={n.task.task_id} delay={i * motion.stagger}>
                  <NewsCard news={n} entry={entry} onPress={() => openTask(n.task.task_id)} />
                </Enter>
              ))}
            </View>
          ) : null}

          {tasks.length === 0 ? <Body muted>{t("noTasks")}</Body> : null}
          {byStatus(tasks).map((g) => (
            <View key={g.status} style={{ gap: space.m }}>
              <Text style={{ color: c.muted, fontFamily: fonts.display, fontSize: 12, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" }}>
                {`${t(STATUS_TEXT[g.status])} · ${g.tasks.length}`}
              </Text>
              {g.tasks.map((task) => (
                <Enter key={task.task_id} delay={Math.min(index++, 6) * motion.stagger}>
                  <TaskCard task={task} state={state} now={now} isNew={fresh.has(task.task_id)} onPress={() => openTask(task.task_id)} />
                </Enter>
              ))}
            </View>
          ))}

          <Sheet visible={filtering} onClose={() => setFiltering(false)} title={t("taskFilters")} testID="filters-sheet">
            {scopes.size > 1 ? (
              <View style={{ gap: space.xs }}>
                <Label>{t("taskFilterScope")}</Label>
                <Choices<string | null>
                  testID="scope"
                  value={scope}
                  onChange={setScope}
                  options={[{ value: null, label: t("taskFilterAll") }, ...[...scopes.entries()].map(([value, label]) => ({ value, label }))]}
                />
              </View>
            ) : null}
            {tags.length > 0 ? (
              <View style={{ gap: space.xs }}>
                <Label>{t("taskFilterTag")}</Label>
                <Choices<string | null> testID="tag" value={tag} onChange={setTag} options={[{ value: null, label: t("taskFilterAll") }, ...tags.map((x) => ({ value: x, label: `#${x}` }))]} />
              </View>
            ) : null}
            <Button testID="filters-show" allowReadOnly label={`${t("taskFilterShow")} (${tasks.length})`} onPress={() => setFiltering(false)} />
            {active ? (
              <Button
                kind="secondary"
                compact
                allowReadOnly
                label={t("taskFilterClear")}
                onPress={() => {
                  setScope(null);
                  setTag(null);
                }}
              />
            ) : null}
          </Sheet>
        </>
      )}
    </>
  );
}
