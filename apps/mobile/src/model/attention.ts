// What is waiting for a person in a community, as counts for the home screen
// and the sidebar: questions from the organizers and invitations to answer,
// and news on the tasks.

import type { CommunityState } from "@vamo-virar/domain";
import type { TaskMarks } from "@vamo-virar/sync";
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
