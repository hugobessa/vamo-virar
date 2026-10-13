// The task board. A strip of figures on top, then one of four views: this
// person's own work ("Minhas"), the tasks waiting for someone ("Fila"), the
// open work of everyone by who is responsible ("Equipe"), and everything by
// status ("Todas"). What changed since this person last looked sits above
// the view. Filtering by action and tag opens in a sheet and applies to the
// two views that list other people's work. Managers add tasks from here.

import { canModerate, type Task, type TaskStatus } from "@vamo-virar/domain";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useApp, useNow } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { canManage as canManageEvent } from "../../model/events";
import { fill } from "../../model/i18n";
import {
  allTags,
  BOARD_VIEW_TEXT,
  BOARD_VIEWS,
  boardSummary,
  byAssignee,
  byStatus,
  defaultView,
  lastSeq,
  myTasks,
  NEWS_TEXT,
  newsFor,
  STATUS_TEXT,
  visibleTasks,
  type BoardView,
  type TaskFilter,
  type TaskNews,
} from "../../model/tasks";
import { Body, Button, Card, EmptyState, Enter, Grid, GroupHeading, Segmented, Sheet, Stats } from "../kit";
import { useLayout } from "../layout";
import { fonts, motion, radius, space, touch, useTheme } from "../theme";
import { Choices, Label, nameOf, TaskCard } from "../tasks/TaskBits";

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

/** A titled group of task cards; nothing when the group is empty. */
function TaskGroup({ title, n, tasks, children, testID }: { title: string; n?: number; tasks: Task[]; children: (task: Task) => ReactNode; testID?: string }) {
  const l = useLayout();
  if (tasks.length === 0) return null;
  return (
    <View testID={testID} style={{ gap: space.m }}>
      <GroupHeading text={title} n={n ?? tasks.length} />
      <Grid columns={l.listColumns}>{tasks.map(children)}</Grid>
    </View>
  );
}

export function TasksTab({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const c = useTheme();
  const l = useLayout();
  const now = useNow();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const all = visibleTasks(state, me);
  const [view, setView] = useState<BoardView>(() => defaultView(all, me));
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

  const summary = boardSummary(all, me, now);
  const filter: TaskFilter = { ...(scope ? { scope } : {}), ...(tag ? { tag } : {}) };
  const filtered = visibleTasks(state, me, filter);
  const scopes = new Map<string, string>();
  for (const task of all) {
    const key = task.event_id ?? "community";
    const title = task.event_id === undefined ? t("taskScopeCommunity") : (state.events[task.event_id]?.title ?? state.event_summaries[task.event_id]?.title ?? "?");
    scopes.set(key, title);
  }
  const tags = allTags(state);
  const news = newsFor(state, me, r.taskMarks);
  const fresh = new Set(news.map((n) => n.task.task_id));
  const active = (scope ? 1 : 0) + (tag ? 1 : 0);
  // Filters narrow the two views that list other people's work.
  const filterable = view === "all" || view === "team";
  const canFilter = filterable && (scopes.size > 1 || tags.length > 0);
  let index = 0;
  const card = (task: Task) => (
    <Enter key={task.task_id} delay={Math.min(index++, 6) * motion.stagger}>
      <TaskCard task={task} state={state} now={now} isNew={fresh.has(task.task_id)} onPress={() => openTask(task.task_id)} />
    </Enter>
  );

  if (all.length === 0) {
    return (
      <EmptyState
        testID="no-tasks"
        title={t("noTasks")}
        body={mayCreate ? t("noTasksBody") : t("noTasksMember")}
        action={mayCreate ? t("noTasksCta") : undefined}
        actionTestID="new-task"
        onAction={mayCreate ? newTask : undefined}
      />
    );
  }

  const mine = myTasks(all, me);
  const pool = visibleTasks(state, me, { status: "awaiting_volunteer" as TaskStatus });
  const team = byAssignee(state, filtered);

  return (
    <>
      <Stats
        items={[
          { value: summary.open, label: t("taskStatOpen"), testID: "stat-open" },
          { value: summary.mine, label: t("taskStatMine"), testID: "stat-mine" },
          { value: summary.pool, label: t("taskStatPool"), tone: "warn", testID: "stat-pool" },
          { value: summary.overdue, label: t("taskStatOverdue"), tone: "danger", testID: "stat-overdue" },
        ]}
      />
      <Segmented<BoardView>
        value={view}
        onChange={setView}
        options={BOARD_VIEWS.map((v) => ({ value: v, label: t(BOARD_VIEW_TEXT[v]), ...(v === "pool" ? { badge: summary.pool } : {}) }))}
      />
      {canFilter || mayCreate ? (
        // Two half-width buttons on a phone; where there is room they hug their labels.
        <View style={{ flexDirection: "row", gap: space.s }}>
          {canFilter ? (
            <View style={l.compact ? { flex: 1 } : null}>
              <Button testID="open-filters" kind="secondary" compact allowReadOnly label={active ? fill(t("taskFiltersActive"), { n: active }) : t("taskFilters")} onPress={() => setFiltering(true)} />
            </View>
          ) : null}
          {mayCreate ? (
            <View style={l.compact ? { flex: 1 } : null}>
              <Button testID="new-task" compact label={`+ ${t("newTask")}`} onPress={newTask} />
            </View>
          ) : null}
        </View>
      ) : null}
      {active && filterable ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
          {scope ? <FilterChip testID="filter-scope" label={scopes.get(scope) ?? "?"} onRemove={() => setScope(null)} /> : null}
          {tag ? <FilterChip testID="filter-tag" label={`#${tag}`} onRemove={() => setTag(null)} /> : null}
        </View>
      ) : null}

      {news.length > 0 && (view === "mine" || (view === "all" && !active)) ? (
        <View style={{ gap: space.m }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <GroupHeading tone="brand" text={t("taskNewsTitle")} n={news.length} />
            <Text
              accessibilityRole="button"
              testID="news-seen-all"
              onPress={() => news.forEach((n) => store.markTaskSeen(entry.id, n.task.task_id, lastSeq(n.task)))}
              style={{ color: c.primary, fontFamily: fonts.text, fontSize: 14, fontWeight: "700" }}
            >
              {t("taskNewsSeenAll")}
            </Text>
          </View>
          <Grid columns={l.listColumns}>
            {news.slice(0, 3).map((n, i) => (
              <Enter key={n.task.task_id} delay={i * motion.stagger}>
                <NewsCard news={n} entry={entry} onPress={() => openTask(n.task.task_id)} />
              </Enter>
            ))}
          </Grid>
        </View>
      ) : null}

      {view === "mine" ? (
        mine.assigned.length + mine.helping.length + mine.created.length === 0 ? (
          <EmptyState testID="mine-empty" title={t("taskMineEmpty")} body={summary.pool > 0 ? t("taskMineEmptyBody") : undefined} action={summary.pool > 0 ? t("taskMineEmptyCta") : undefined} onAction={() => setView("pool")} />
        ) : (
          <>
            <TaskGroup testID="mine-assigned" title={t("taskMineAssigned")} tasks={mine.assigned}>{card}</TaskGroup>
            <TaskGroup testID="mine-helping" title={t("taskMineHelping")} tasks={mine.helping}>{card}</TaskGroup>
            <TaskGroup testID="mine-created" title={t("taskMineCreated")} tasks={mine.created}>{card}</TaskGroup>
          </>
        )
      ) : null}

      {view === "pool" ? (
        pool.length === 0 ? (
          <EmptyState testID="pool-empty" title={t("taskPoolEmpty")} body={t("taskPoolEmptyBody")} />
        ) : (
          <>
            <Body muted>{t("taskPoolIntro")}</Body>
            <Grid columns={l.listColumns}>{pool.map(card)}</Grid>
          </>
        )
      ) : null}

      {view === "team" ? (
        team.length === 0 ? (
          <Body muted>{t("taskTeamEmpty")}</Body>
        ) : (
          team.map((g) => (
            <TaskGroup key={g.assignee ?? "nobody"} testID={`team-${g.assignee ?? "nobody"}`} title={g.assignee === undefined ? t("taskTeamUnassigned") : nameOf(state, g.assignee, t("formerMember"))} tasks={g.tasks}>
              {card}
            </TaskGroup>
          ))
        )
      ) : null}

      {view === "all" ? (
        <>
          {filtered.length === 0 ? <Body muted>{t("noTasks")}</Body> : null}
          {byStatus(filtered).map((g) => (
            <TaskGroup key={g.status} title={t(STATUS_TEXT[g.status])} tasks={g.tasks}>
              {card}
            </TaskGroup>
          ))}
        </>
      ) : null}

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
        <Button testID="filters-show" allowReadOnly label={`${t("taskFilterShow")} (${filtered.length})`} onPress={() => setFiltering(false)} />
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
  );
}
