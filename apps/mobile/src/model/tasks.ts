// Pure view-model logic for tasks (protocol.md §9.7): what a person sees on
// the board and which actions they can take. Mirrors the reducer so the UI
// never offers something it would reject.

import {
  canManageTask,
  canSeeTask,
  isOnTask,
  type CommunityState,
  type MemberRecord,
  type Task,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
  type TaskStatusChange,
} from "@vamo-virar/domain";
import type { TaskMarks } from "@vamo-virar/sync";
import type { StringKey } from "./i18n";

export const STATUS_ORDER: readonly TaskStatus[] = ["awaiting_volunteer", "todo", "in_progress", "blocked", "done", "cancelled"];
export const OPEN_STATUSES: readonly TaskStatus[] = ["awaiting_volunteer", "todo", "in_progress", "blocked"];
export const PRIORITY_ORDER: readonly TaskPriority[] = ["urgent", "high", "normal", "low"];

export const STATUS_TEXT: Record<TaskStatus, StringKey> = {
  awaiting_volunteer: "taskAwaiting",
  todo: "taskTodo",
  in_progress: "taskInProgress",
  blocked: "taskBlocked",
  done: "taskDone",
  cancelled: "taskCancelled",
};

export const PRIORITY_TEXT: Record<TaskPriority, StringKey> = {
  low: "priorityLow",
  normal: "priorityNormal",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

export type SelfAction = "take" | "unassign" | "join" | "leave";

export const SELF_ACTION_TEXT: Record<SelfAction, StringKey> = {
  take: "taskTake",
  unassign: "taskUnassign",
  join: "taskJoin",
  leave: "taskLeave",
};

export function isOpen(task: Task): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

export function canManage(state: CommunityState, task: Task, me: MemberRecord | undefined): boolean {
  return !!me && canManageTask(state, me, task);
}

export function canSee(state: CommunityState, task: Task, me: MemberRecord | undefined): boolean {
  return !!me && canSeeTask(state, me, task);
}

/** Managers, and the assignee, edit title, description, tags, priority, due date and files. */
export function canEdit(state: CommunityState, task: Task, me: MemberRecord | undefined): boolean {
  return !!me && isOpen(task) && (canManage(state, task, me) || task.assignee === me.member_id);
}

/**
 * Actions about the person's own place on the task, primary first. A manager
 * also gets `take` (taking it over) and `unassign` (clearing someone else);
 * the screen words those differently.
 */
export function selfActions(state: CommunityState, task: Task, me: MemberRecord | undefined): SelfAction[] {
  if (!me || me.status !== "active" || !isOpen(task)) return [];
  const out: SelfAction[] = [];
  const manager = canManage(state, task, me);
  if (task.assignee === undefined || (manager && task.assignee !== me.member_id)) out.push("take");
  if (task.assignee !== undefined && (task.assignee === me.member_id || manager)) out.push("unassign");
  if (task.volunteers.includes(me.member_id)) out.push("leave");
  else if (task.assignee !== me.member_id) out.push("join");
  return out;
}

/** Statuses this person may move the task to right now, in board order. */
export function statusTargets(state: CommunityState, task: Task, me: MemberRecord | undefined): TaskStatus[] {
  if (!me || me.status !== "active") return [];
  const manager = canManage(state, task, me);
  const on = isOnTask(me, task);
  if (!isOpen(task)) return manager ? [task.assignee === undefined ? "awaiting_volunteer" : "todo"] : [];
  const out: TaskStatus[] = [];
  if (task.assignee !== undefined && (manager || on)) {
    for (const s of ["todo", "in_progress", "blocked"] as const) if (s !== task.status) out.push(s);
  }
  if (task.status === "awaiting_volunteer" ? manager : manager || on) out.push("done");
  if (manager) out.push("cancelled");
  return out;
}

export function canComment(state: CommunityState, task: Task, me: MemberRecord | undefined): boolean {
  return canSee(state, task, me);
}

export function canRemove(state: CommunityState, task: Task, me: MemberRecord | undefined): boolean {
  return canManage(state, task, me);
}

export function canDeleteComment(state: CommunityState, task: Task, c: TaskComment, me: MemberRecord | undefined): boolean {
  return !!me && (c.author === me.member_id || canManage(state, task, me));
}

// --- the board ---------------------------------------------------------------

export interface TaskFilter {
  /** An event id, "community" for tasks without one, or undefined for everything. */
  scope?: string;
  tag?: string;
  status?: TaskStatus;
  /** Only tasks this person is on. */
  mine?: boolean;
}

/** Tasks this person may see, filtered, most urgent and most recently touched first. */
export function visibleTasks(state: CommunityState, me: MemberRecord | undefined, f: TaskFilter = {}): Task[] {
  return Object.values(state.tasks ?? {})
    .filter((t) => canSee(state, t, me))
    .filter((t) => f.scope === undefined || (f.scope === "community" ? t.event_id === undefined : t.event_id === f.scope))
    .filter((t) => f.tag === undefined || t.tags.includes(f.tag))
    .filter((t) => f.status === undefined || t.status === f.status)
    .filter((t) => !f.mine || (!!me && isOnTask(me, t)))
    .sort(compareTasks);
}

export function compareTasks(a: Task, b: Task): number {
  const due = (a.due_at ?? Number.MAX_SAFE_INTEGER) - (b.due_at ?? Number.MAX_SAFE_INTEGER);
  if (due !== 0) return due;
  const p = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  if (p !== 0) return p;
  return b.updated_seq - a.updated_seq;
}

export function byStatus(tasks: Task[]): { status: TaskStatus; tasks: Task[] }[] {
  return STATUS_ORDER.map((status) => ({ status, tasks: tasks.filter((t) => t.status === status) })).filter((g) => g.tasks.length > 0);
}

/** Every tag in use, most used first. */
export function allTags(state: CommunityState): string[] {
  const n = new Map<string, number>();
  for (const t of Object.values(state.tasks ?? {})) for (const tag of t.tags) n.set(tag, (n.get(tag) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/** Open tasks of one event, for the event screen. */
export function tasksOfEvent(state: CommunityState, eventId: string, me: MemberRecord | undefined): Task[] {
  return visibleTasks(state, me, { scope: eventId });
}

/** How many open tasks wait for a volunteer, for a badge on the tab. */
export function awaitingCount(state: CommunityState): number {
  return Object.values(state.tasks ?? {}).filter((t) => t.status === "awaiting_volunteer").length;
}

export function isOverdue(task: Task, now: number): boolean {
  return isOpen(task) && task.due_at !== undefined && task.due_at < now;
}

// --- the board's views -----------------------------------------------------------

/** The four ways of looking at the board: this person's work, the pool, everyone's work, everything. */
export type BoardView = "mine" | "pool" | "team" | "all";

export const BOARD_VIEWS: readonly BoardView[] = ["mine", "pool", "team", "all"];

export const BOARD_VIEW_TEXT: Record<BoardView, StringKey> = {
  mine: "taskViewMine",
  pool: "taskViewPool",
  team: "taskViewTeam",
  all: "taskViewAll",
};

/** The numbers at the top of the board, over the tasks this person may see. */
export interface BoardSummary {
  open: number;
  overdue: number;
  pool: number;
  /** Open tasks this person is responsible for or helps with. */
  mine: number;
  done: number;
}

export function boardSummary(tasks: readonly Task[], me: MemberRecord | undefined, now: number): BoardSummary {
  const s: BoardSummary = { open: 0, overdue: 0, pool: 0, mine: 0, done: 0 };
  for (const t of tasks) {
    if (t.status === "done") s.done++;
    if (!isOpen(t)) continue;
    s.open++;
    if (isOverdue(t, now)) s.overdue++;
    if (t.status === "awaiting_volunteer") s.pool++;
    if (me && isOnTask(me, t)) s.mine++;
  }
  return s;
}

/** "Minhas": the open tasks this person is responsible for, helps with, and created but handed to others. */
export interface MyTasks {
  assigned: Task[];
  helping: Task[];
  created: Task[];
}

export function myTasks(tasks: readonly Task[], me: MemberRecord | undefined): MyTasks {
  const out: MyTasks = { assigned: [], helping: [], created: [] };
  if (!me) return out;
  for (const t of tasks) {
    if (!isOpen(t)) continue;
    if (t.assignee === me.member_id) out.assigned.push(t);
    else if (t.volunteers.includes(me.member_id)) out.helping.push(t);
    else if (t.created_by === me.member_id) out.created.push(t);
  }
  return out;
}

/** The view to open the board on: this person's work when they have some, everything otherwise. */
export function defaultView(tasks: readonly Task[], me: MemberRecord | undefined): BoardView {
  const mine = myTasks(tasks, me);
  return mine.assigned.length + mine.helping.length > 0 ? "mine" : "all";
}

/** "Equipe": open tasks by the person responsible, by name, the ones without anyone last. */
export function byAssignee(state: CommunityState, tasks: readonly Task[]): { assignee: string | undefined; tasks: Task[] }[] {
  const groups = new Map<string | undefined, Task[]>();
  for (const t of tasks) {
    if (!isOpen(t)) continue;
    const list = groups.get(t.assignee);
    if (list) list.push(t);
    else groups.set(t.assignee, [t]);
  }
  const name = (id: string | undefined) => (id === undefined ? "" : (state.members[id]?.profile?.display_name ?? ""));
  return [...groups.entries()]
    .map(([assignee, list]) => ({ assignee, tasks: list }))
    .sort((a, b) => {
      if (a.assignee === undefined) return 1;
      if (b.assignee === undefined) return -1;
      return name(a.assignee).localeCompare(name(b.assignee)) || b.tasks.length - a.tasks.length;
    });
}

const DAY = 86_400_000;
const dayOf = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY;
};

/**
 * The due date in words, relative to today: "vence amanhã", "em 5 dias",
 * "atrasada há 2 dias". `soon` is today or tomorrow. Closed tasks keep the plain date.
 */
export function dueLabel(task: Task, now: number): { key: StringKey; n: number; late: boolean; soon: boolean } | null {
  if (task.due_at === undefined) return null;
  if (!isOpen(task)) return { key: "taskDue_", n: 0, late: false, soon: false };
  const days = dayOf(task.due_at) - dayOf(now);
  if (isOverdue(task, now)) return { key: days >= -1 ? "taskOverdueYesterday" : "taskOverdueDays", n: Math.max(1, -days), late: true, soon: false };
  if (days <= 0) return { key: "taskDueToday", n: 0, late: false, soon: true };
  if (days === 1) return { key: "taskDueTomorrow", n: 1, late: false, soon: true };
  return { key: "taskDueInDays", n: days, late: false, soon: false };
}

// --- the timeline --------------------------------------------------------------

export type TimelineItem = { kind: "comment"; seq: number; comment: TaskComment } | { kind: "status"; seq: number; change: TaskStatusChange };

/** Comments and status changes in one list, oldest first. */
export function timeline(task: Task): TimelineItem[] {
  const items: TimelineItem[] = [
    ...task.comments.map((comment): TimelineItem => ({ kind: "comment", seq: comment.seq, comment })),
    ...task.history.map((change): TimelineItem => ({ kind: "status", seq: change.seq, change })),
  ];
  return items.sort((a, b) => a.seq - b.seq);
}

/** Splits "som, arte , Som" into clean tags, as the reducer will store them. */
export function parseTagInput(s: string): string[] {
  const out = new Set<string>();
  for (const raw of s.split(/[,\n]/)) {
    const t = raw.trim().toLowerCase();
    if (t) out.add(t);
  }
  return [...out].sort();
}

/** Name of the event a task belongs to, from live events or summaries. */
export function scopeTitle(state: CommunityState, task: Task): string | undefined {
  if (task.event_id === undefined) return undefined;
  return state.events[task.event_id]?.title ?? state.event_summaries[task.event_id]?.title;
}

// --- news ---------------------------------------------------------------------

export type NewsReason = "assigned" | "comment" | "status" | "updated" | "pool";

export interface TaskNews {
  task: Task;
  reason: NewsReason;
  /** Who did it; absent when the log does not say (an edit, a handover). */
  by?: string;
  seq: number;
}

/** The last position in the log that touched the task, to mark it seen. */
export function lastSeq(task: Task): number {
  let n = Math.max(task.updated_seq, task.created_seq);
  for (const c of task.comments) n = Math.max(n, c.seq, c.edited_seq ?? 0);
  for (const h of task.history) n = Math.max(n, h.seq);
  return n;
}

/**
 * What happened on a task since this person last looked at it, by someone
 * else. Tasks they are on or created report the newest comment or status
 * change; a task they are not on reports only its arrival in the pool.
 */
export function taskNews(state: CommunityState, task: Task, me: MemberRecord | undefined, marks: TaskMarks): TaskNews | null {
  if (!me || me.status !== "active" || !canSee(state, task, me)) return null;
  const seen = marks.tasks[task.task_id] ?? marks.since;
  const mine = me.member_id;
  if (isOnTask(me, task) || task.created_by === mine) {
    let news: TaskNews | null = null;
    for (const c of task.comments) {
      if (c.author !== mine && c.seq > seen && (!news || c.seq > news.seq)) news = { task, reason: "comment", by: c.author, seq: c.seq };
    }
    for (const h of task.history) {
      if (h.by === mine || h.seq <= seen || (news && h.seq < news.seq)) continue;
      news = { task, reason: task.assignee === mine && h.status === "todo" ? "assigned" : "status", by: h.by, seq: h.seq };
    }
    // Edits and handovers leave no line of their own: a newer touch that is not this person's comment or status change.
    const own =
      task.comments.some((c) => c.author === mine && (c.seq === task.updated_seq || c.edited_seq === task.updated_seq)) ||
      task.history.some((h) => h.by === mine && h.seq === task.updated_seq);
    if (!news && task.updated_seq > seen && !own) news = { task, reason: "updated", seq: task.updated_seq };
    return news;
  }
  if (task.status === "awaiting_volunteer" && task.created_by !== mine && task.created_seq > seen) {
    return { task, reason: "pool", by: task.created_by, seq: task.created_seq };
  }
  return null;
}

/** Every task with news for this person, newest first. */
export function newsFor(state: CommunityState, me: MemberRecord | undefined, marks: TaskMarks): TaskNews[] {
  return Object.values(state.tasks ?? {})
    .map((task) => taskNews(state, task, me, marks))
    .filter((n): n is TaskNews => n !== null)
    .sort((a, b) => b.seq - a.seq);
}

export const NEWS_TEXT: Record<NewsReason, StringKey> = {
  assigned: "taskNewsAssigned",
  comment: "taskNewsComment",
  status: "taskNewsStatus",
  updated: "taskNewsUpdated",
  pool: "taskNewsPool",
};
