// Who an operation is addressed to (protocol.md §14): the people a device
// should wake up when it submits a mention, an assignment or an invitation.
// Pure over the op and the current state, so the sync layer can post one
// sealed `ping` per recipient and the app can explain what arrived.

import type { CommunityState, MemberId } from "./types.js";
import { isHex, isObject } from "./util.js";

/** Why someone is being told; the app words each one. */
export type NoticeKind = "mention" | "assigned" | "invited";

export interface Recipient {
  member_id: MemberId;
  kind: NoticeKind;
}

/**
 * Active members, other than the author, that `type`/`body` addresses:
 * people `@`-mentioned in a new comment (or newly mentioned in an edit),
 * the person made responsible for a task, and the member invited to an
 * event. Anything else addresses nobody in particular. Never throws on a
 * malformed body: the reducer judges that; this only picks recipients.
 */
export function recipientsOf(state: CommunityState, author: MemberId, type: string, body: unknown): Recipient[] {
  if (!isObject(body)) return [];
  const out: Recipient[] = [];
  const add = (id: unknown, kind: NoticeKind) => {
    if (!isHex(id, 32) || id === author || state.members[id]?.status !== "active") return;
    if (!out.some((r) => r.member_id === id && r.kind === kind)) out.push({ member_id: id, kind });
  };
  switch (type) {
    case "task.comment":
      for (const id of listOf(body.mentions)) add(id, "mention");
      break;
    case "task.comment_edit": {
      // Only people the edit adds: the others were told when the comment was posted.
      const { task_id, comment_id } = body;
      const current = isHex(task_id, 16) && isHex(comment_id, 16) ? state.tasks?.[task_id]?.comments.find((c) => c.comment_id === comment_id) : undefined;
      const before = new Set<unknown>(current?.mentions ?? []);
      for (const id of listOf(body.mentions)) if (!before.has(id)) add(id, "mention");
      break;
    }
    case "task.create":
      add(body.assignee, "assigned");
      break;
    case "task.assign":
      add(body.member_id, "assigned");
      break;
    case "participation.invite":
      add(body.member_id, "invited");
      break;
  }
  return out;
}

function listOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
