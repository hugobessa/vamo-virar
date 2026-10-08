// Pure view-model logic for events: what to show and which actions a person
// can take. Mirrors the domain state machine (protocol.md §9.4) so the UI
// never offers something the reducer would reject.

import { isAdmin, isOrganizer, type CommunityState, type Event, type MemberRecord, type ParticipationStatus } from "@vamo-virar/domain";
import type { StringKey } from "./i18n";

export type SelfAction = "volunteer" | "accept" | "decline" | "withdraw";
export type OrgAction = "invite" | "revoke" | "approve" | "reject";

type From = ParticipationStatus | "none";

const SELF: Record<SelfAction, From[]> = {
  volunteer: ["none", "withdrawn", "declined"],
  accept: ["invited", "reconfirm"],
  decline: ["invited", "reconfirm"],
  withdraw: ["volunteered", "confirmed", "reconfirm"],
};

const ORG: Record<OrgAction, From[]> = {
  invite: ["none", "declined", "withdrawn", "not_selected", "revoked"],
  revoke: ["invited"],
  approve: ["volunteered"],
  reject: ["volunteered"],
};

export function statusOf(ev: Event, memberId: string): From {
  return ev.participations[memberId]?.status ?? "none";
}

export function confirmedCount(ev: Event): number {
  return Object.values(ev.participations).filter((p) => p.status === "confirmed").length;
}

export function isFull(ev: Event): boolean {
  return ev.capacity !== undefined && confirmedCount(ev) >= ev.capacity;
}

/** Actions the person can take for themselves on this event, primary first. */
export function selfActions(state: CommunityState, ev: Event, me: MemberRecord | undefined): SelfAction[] {
  if (!me || me.status !== "active" || ev.status !== "scheduled") return [];
  const from = statusOf(ev, me.member_id);
  const full = isFull(ev);
  const order: SelfAction[] = ["accept", "volunteer", "decline", "withdraw"];
  return order.filter((a) => {
    if (!SELF[a].includes(from)) return false;
    // Can't become confirmed into a full event; volunteering in confirm mode is fine.
    if (a === "accept" && full) return false;
    if (a === "volunteer" && full && state.community.policy.volunteer_mode === "auto") return false;
    return true;
  });
}

export function canOrganize(state: CommunityState, me: MemberRecord | undefined): boolean {
  return !!me && isOrganizer(state, me);
}

export function canManage(state: CommunityState, ev: Event, me: MemberRecord | undefined): boolean {
  if (!me) return false;
  return isAdmin(state, me) || (isOrganizer(state, me) && ev.organizers.includes(me.member_id));
}

export function orgActionsFor(state: CommunityState, ev: Event, me: MemberRecord | undefined, target: string): OrgAction[] {
  if (!canOrganize(state, me) || ev.status !== "scheduled") return [];
  const m = state.members[target];
  if (!m || m.status !== "active") return [];
  const from = statusOf(ev, target);
  return (Object.keys(ORG) as OrgAction[]).filter((a) => {
    if (!ORG[a].includes(from)) return false;
    if (a === "approve" && isFull(ev)) return false;
    return true;
  });
}

/** Active members who can still be invited to this event. */
export function invitable(state: CommunityState, ev: Event): MemberRecord[] {
  return Object.values(state.members)
    .filter((m) => m.status === "active" && ORG.invite.includes(statusOf(ev, m.member_id)))
    .sort((a, b) => (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? ""));
}

export function byStatus(state: CommunityState, ev: Event, statuses: ParticipationStatus[]): MemberRecord[] {
  return Object.entries(ev.participations)
    .filter(([, p]) => statuses.includes(p.status))
    .map(([id]) => state.members[id])
    .filter((m): m is MemberRecord => !!m);
}

export function upcoming(state: CommunityState, now: number): Event[] {
  return Object.values(state.events)
    .filter((e) => e.status === "scheduled" && e.ends_at >= now)
    .sort((a, b) => a.starts_at - b.starts_at);
}

export function past(state: CommunityState, now: number): Event[] {
  return Object.values(state.events)
    .filter((e) => e.status !== "scheduled" || e.ends_at < now)
    .sort((a, b) => b.starts_at - a.starts_at);
}

export const STATUS_TEXT: Record<ParticipationStatus, StringKey> = {
  invited: "statusInvited",
  volunteered: "statusVolunteered",
  confirmed: "statusConfirmed",
  reconfirm: "statusReconfirm",
  declined: "statusDeclined",
  withdrawn: "statusWithdrawn",
  not_selected: "statusNotSelected",
  revoked: "statusRevoked",
};

export const ACTION_TEXT: Record<SelfAction | OrgAction, StringKey> = {
  volunteer: "volunteer",
  accept: "accept",
  decline: "decline",
  withdraw: "withdraw",
  invite: "invite",
  revoke: "revoke",
  approve: "approve",
  reject: "reject",
};

export function roleKey(state: CommunityState, m: MemberRecord): StringKey {
  if (isAdmin(state, m)) return "roleAdmin";
  if (m.role === "organizer" || m.role === "admin") return "roleOrganizer";
  return "roleMember";
}
