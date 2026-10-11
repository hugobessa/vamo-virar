import type { Policy } from "./types.js";
import { isInt, isObject, isText } from "./util.js";

export const DEFAULT_POLICY: Policy = {
  join: "request",
  rotate_on_join: false,
  volunteer_mode: "confirm",
  participation_visible: "community",
  retention: {
    completed_event_detail_days: 30,
    keep_attendee_list: false,
    removed_member_detail_days: 30,
    rejected_join_request_days: 7,
  },
};

export type PolicyParse =
  | { ok: true; policy: Policy }
  | { ok: false; reason: "malformed" | "unsupported" };

const DAYS_MAX = 36_500;

/** `retention.closed_task_detail_days` when the policy does not set it (§9.7). */
export const DEFAULT_CLOSED_TASK_DAYS = 30;

export function closedTaskDays(policy: Policy): number {
  return policy.retention.closed_task_detail_days ?? DEFAULT_CLOSED_TASK_DAYS;
}

export function parsePolicy(v: unknown): PolicyParse {
  if (!isObject(v) || !isObject(v.retention)) return { ok: false, reason: "malformed" };
  const r = v.retention;
  if (
    !(v.join === "invite_only" || v.join === "request" || v.join === "open_request") ||
    typeof v.rotate_on_join !== "boolean" ||
    !(v.volunteer_mode === "confirm" || v.volunteer_mode === "auto") ||
    !(v.participation_visible === "community" || v.participation_visible === "organizers") ||
    !isInt(r.completed_event_detail_days, 0, DAYS_MAX) ||
    typeof r.keep_attendee_list !== "boolean" ||
    !isInt(r.removed_member_detail_days, 0, DAYS_MAX) ||
    !isInt(r.rejected_join_request_days, 0, DAYS_MAX) ||
    (r.closed_task_detail_days !== undefined && !isInt(r.closed_task_detail_days, 0, DAYS_MAX)) ||
    (v.min_client_version !== undefined && !isText(v.min_client_version, 32, 1))
  ) {
    return { ok: false, reason: "malformed" };
  }
  // protocol.md §9.5: MVP clients must refuse sealed participation.
  if (v.participation_visible === "organizers") return { ok: false, reason: "unsupported" };

  const policy: Policy = {
    join: v.join,
    rotate_on_join: v.rotate_on_join,
    volunteer_mode: v.volunteer_mode,
    participation_visible: v.participation_visible,
    retention: {
      completed_event_detail_days: r.completed_event_detail_days,
      keep_attendee_list: r.keep_attendee_list,
      removed_member_detail_days: r.removed_member_detail_days,
      rejected_join_request_days: r.rejected_join_request_days,
    },
  };
  if (r.closed_task_detail_days !== undefined) policy.retention.closed_task_detail_days = r.closed_task_detail_days;
  if (v.min_client_version !== undefined) policy.min_client_version = v.min_client_version;
  return { ok: true, policy };
}
