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
