// What is waiting for a person in a community, as counts for the home screen
// and the sidebar: questions from the organizers and invitations to answer,
// and news on the tasks.

import type { CommunityState } from "@vamo-virar/domain";
import type { NoticeMarks, TaskMarks } from "@vamo-virar/sync";
import { unreadNotices } from "./notifications";
import { newsFor } from "./tasks";

/** Questions from the organizers (`probes`) plus open invitations to scheduled actions. */
export function toAnswerCount(view: CommunityState | null | undefined, memberId: string, probes: number): number {
  const invited = view ? Object.values(view.events).filter((ev) => ev.status === "scheduled" && ev.participations[memberId]?.status === "invited").length : 0;
  return probes + invited;
}

/** Tasks with something new since this person last looked; none unless the membership is active. */
export function taskNewsCount(view: CommunityState | null | undefined, memberId: string, marks: TaskMarks, active: boolean): number {
  return view && active ? newsFor(view, view.members[memberId], marks).length : 0;
}

/** Unread notifications (mentions, handovers, invitations). */
export function noticeCount(view: CommunityState | null | undefined, memberId: string, marks: NoticeMarks, active: boolean): number {
  return view && active ? unreadNotices(view, view.members[memberId], marks).length : 0;
}

/**
 * The one number on a community's row: things to answer, task news and
 * unread mentions. Handovers and invitations are not added again: they are
 * already in the other two.
 */
export function attentionCount(view: CommunityState | null | undefined, memberId: string, probes: number, taskMarks: TaskMarks, noticeMarks: NoticeMarks, active: boolean): number {
  const mentions = view && active ? unreadNotices(view, view.members[memberId], noticeMarks).filter((n) => n.kind === "mention").length : 0;
  return toAnswerCount(view, memberId, probes) + taskNewsCount(view, memberId, taskMarks, active) + mentions;
}
