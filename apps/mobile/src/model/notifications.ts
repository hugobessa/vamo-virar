// What was addressed to this person, read off the community state: `@`
// mentions in comments, tasks handed to them, invitations to actions. The
// list is derived, so it is the same on every device and after a reinstall;
// only "seen up to where" lives on the device (NoticeMarks in the replica).

import { canSeeTask, type CommunityState, type Event, type MemberRecord, type NoticeKind, type Task, type TaskComment } from "@vamo-virar/domain";
import type { NoticeMarks } from "@vamo-virar/sync";
import type { StringKey } from "./i18n";

export interface Notice {
  /** Stable across syncs, so the list does not jump. */
  id: string;
  kind: NoticeKind;
  /** Log position; newer is bigger, and `seen` compares against it. */
  seq: number;
  /** Who did it. */
  by: string;
  task?: Task;
  comment?: TaskComment;
  event?: Event;
}

const MAX = 100;

/** Everything addressed to `me`, newest first. */
export function noticesFor(state: CommunityState, me: MemberRecord | undefined): Notice[] {
  if (!me || me.status !== "active") return [];
  const mine = me.member_id;
  const out: Notice[] = [];
  for (const task of Object.values(state.tasks ?? {})) {
    if (!canSeeTask(state, me, task)) continue;
    for (const comment of task.comments) {
      if (comment.author !== mine && comment.mentions?.includes(mine)) {
        // An edit that adds a mention is the first the person hears of it, so edits count as new.
        out.push({ id: `m:${comment.comment_id}`, kind: "mention", seq: comment.edited_seq ?? comment.seq, by: comment.author, task, comment });
      }
    }
    if (task.assignee === mine && task.assigned && task.assigned.by !== mine) {
      out.push({ id: `a:${task.task_id}:${task.assigned.seq}`, kind: "assigned", seq: task.assigned.seq, by: task.assigned.by, task });
    }
  }
  for (const event of Object.values(state.events)) {
    const p = event.participations[mine];
    if (event.status === "scheduled" && p?.status === "invited" && p.by && p.by !== mine) {
      out.push({ id: `i:${event.event_id}:${p.updated_seq}`, kind: "invited", seq: p.updated_seq, by: p.by, event });
    }
  }
  return out.sort((a, b) => b.seq - a.seq).slice(0, MAX);
}

/** Notices this person has not looked at yet. */
export function unreadNotices(state: CommunityState | null | undefined, me: MemberRecord | undefined, marks: NoticeMarks): Notice[] {
  return state ? noticesFor(state, me).filter((n) => n.seq > marks.seen) : [];
}

/** The highest log position among the notices, to mark them all seen. */
export function latestSeq(notices: readonly Notice[]): number {
  return notices.reduce((n, x) => Math.max(n, x.seq), 0);
}

export const NOTICE_TEXT: Record<NoticeKind, StringKey> = {
  mention: "noticeMention",
  assigned: "noticeAssigned",
  invited: "noticeInvited",
};

/** The task or action the notice is about. */
export function noticeSubject(n: Notice): string {
  return n.task?.title ?? n.event?.title ?? "";
}
