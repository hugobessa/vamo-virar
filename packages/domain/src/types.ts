// Domain types for the community state machine (protocol.md §8, §9, §12).
//
// Byte fields are lowercase hex strings at this layer; the protocol package
// converts to and from CBOR byte strings. Integers are JS numbers and must be
// safe integers — the reducer never uses floating point.

export type Hex = string;
export type MemberId = Hex; // SHA-256("vv/member-id/v1" || msk), §2.2
export type EventId = Hex; // 16 random bytes
export type OpId = Hex; // 16 random bytes
export type TaskId = Hex; // 16 random bytes
export type CommentId = Hex; // 16 random bytes

// ---------------------------------------------------------------------------
// Log entries (input to the reducer)
// ---------------------------------------------------------------------------

export type ControlKind = "genesis" | "rotate" | "admin.set" | "migrate" | "mod.set" | "disable" | "enable";

export interface GenesisArgs {
  suite: "VV1";
  crk: Hex;
  admins: Hex[]; // MSK public keys
  eak: Hex;
  ik: Hex;
}

export interface RotateArgs {
  new_epoch: number;
  eak: Hex;
}

export interface AdminSetArgs {
  admins: Hex[];
  ik?: Hex;
}

export interface MigrateArgs {
  /** Base URLs of the node(s) now hosting the community; empty cancels a move. */
  nodes: string[];
}

export interface ModSetArgs {
  /** MSK public keys; empty removes every moderator. */
  moderators: Hex[];
}

export type ControlHeader =
  | { kind: "genesis"; signer: Hex; args: GenesisArgs }
  | { kind: "rotate"; signer: Hex; args: RotateArgs }
  | { kind: "admin.set"; signer: Hex; args: AdminSetArgs }
  | { kind: "migrate"; signer: Hex; args: MigrateArgs }
  | { kind: "mod.set"; signer: Hex; args: ModSetArgs }
  | { kind: "disable"; signer: Hex; args: Record<string, never> }
  | { kind: "enable"; signer: Hex; args: Record<string, never> };

/** The decrypted, signature-verified inner operation (SignedOp minus crypto fields). */
export interface DecodedOp {
  author: Hex; // MSK public of the author
  base: number;
  ts: number; // author clock, advisory only — never used by the reducer
  type: string;
  body: unknown;
}

/**
 * One log entry as seen by the domain engine, after the crypto layer has
 * checked the hash chain, `asig`, control signatures and the inner signature.
 * `op` is null when the device could not decrypt the entry (§8.2 step 4).
 */
export interface Entry {
  seq: number;
  opId: OpId;
  epoch: number;
  at: number; // node receive time (ms); drives the retention clock, §12.2
  control?: ControlHeader;
  op: DecodedOp | null;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  completed_event_detail_days: number;
  keep_attendee_list: boolean;
  removed_member_detail_days: number;
  rejected_join_request_days: number;
  /**
   * Days a done or cancelled task (§9.7) is kept before it is dropped.
   * Absent means `DEFAULT_CLOSED_TASK_DAYS`; it is only stored when set, so
   * policies written before tasks existed hash as before.
   */
  closed_task_detail_days?: number;
}

export interface Policy {
  join: "invite_only" | "request" | "open_request";
  rotate_on_join: boolean;
  volunteer_mode: "confirm" | "auto";
  participation_visible: "community" | "organizers";
  retention: RetentionPolicy;
  min_client_version?: string;
  /**
   * "auto": admin and moderator devices approve join requests as soon as
   * they see them. Absent means each request waits for a person; it is only
   * stored when set, so older policies hash as before.
   */
  join_approval?: "auto";
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Role = "member" | "organizer" | "admin";
export type MemberStatus = "active" | "removed" | "left";

export interface Profile {
  display_name: string;
  contact?: string;
  prk_binding?: Hex;
}

export interface MemberRecord {
  member_id: MemberId;
  msk: Hex;
  mek: Hex;
  role: Role;
  status: MemberStatus;
  /** Null once retention has stripped a removed member's details. */
  profile: Profile | null;
  joined_seq: number;
  key_epoch: number;
  /** Retention clock value when the member was removed or left. */
  ended_at?: number;
  /**
   * Set by `member.block`: the member was removed and may not be added back
   * until an admin unblocks them. Absent (never `false`) when not blocked.
   */
  blocked?: true;
}

export interface Location {
  label: string;
  area: { lat_e4: number; lng_e4: number };
  radius_m?: number;
}

export type EventStatus = "scheduled" | "cancelled" | "completed";

export type ParticipationStatus =
  | "invited"
  | "volunteered"
  | "confirmed"
  | "reconfirm"
  | "declined"
  | "withdrawn"
  | "not_selected"
  | "revoked";

export interface Participation {
  status: ParticipationStatus;
  updated_seq: number;
  /**
   * The organizer behind the last change, when it was not the member's own
   * (`invite`, `revoke`, `approve`, `reject`); absent after a self action.
   * Lets the invited person see who invited them.
   */
  by?: MemberId;
}

export interface Event {
  event_id: EventId;
  title: string;
  description: string;
  starts_at: number;
  ends_at: number;
  tz: string;
  location: Location;
  capacity?: number;
  /** WhatsApp group invite link (https://chat.whatsapp.com/…). */
  whatsapp?: string;
  organizers: MemberId[];
  status: EventStatus;
  created_seq: number;
  /** Retention clock value when the event left `scheduled`. */
  closed_at?: number;
  participations: Record<MemberId, Participation>;
  attended?: MemberId[];
}

export interface EventSummary {
  event_id: EventId;
  title: string;
  starts_at: number;
  status: "cancelled" | "completed";
  confirmed_count: number;
  attended_count: number;
  attendees?: MemberId[];
}

// ---------------------------------------------------------------------------
// Tasks (§9.7): committee work items, scoped to the community or to one event.
// ---------------------------------------------------------------------------

export type TaskStatus = "awaiting_volunteer" | "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

/**
 * A file stored on the node as an opaque blob (§15, `/blobs`). The device
 * encrypts it under a fresh random key before upload; the key travels only
 * inside the (encrypted) task op, so the node sees sizes and nothing else.
 */
export interface Attachment {
  /** SHA-256 of the ciphertext, which is also how the node names the blob. */
  blob_id: Hex;
  /** 32-byte XChaCha20-Poly1305 key, unique to this file. */
  key: Hex;
  /** 24-byte nonce. */
  nonce: Hex;
  name: string;
  mime: string;
  /** Plaintext size in bytes. */
  size: number;
}

export interface TaskComment {
  comment_id: CommentId;
  author: MemberId;
  /** Markdown. */
  body: string;
  seq: number;
  edited_seq?: number;
  /**
   * Members addressed with `@` in the body, sorted and unique; absent when
   * none. Explicit ids, not names, so a mention survives a rename and the
   * notification goes to the person the author picked.
   */
  mentions?: MemberId[];
}

/** One line of a task's status history, oldest first. */
export interface TaskStatusChange {
  status: TaskStatus;
  by: MemberId;
  seq: number;
  note?: string;
}

export interface Task {
  task_id: TaskId;
  /** Absent for community-level tasks. May point at an event summary once the event is summarized. */
  event_id?: EventId;
  title: string;
  /** Markdown. */
  description: string;
  /** Lowercased, sorted, unique. */
  tags: string[];
  status: TaskStatus;
  priority: TaskPriority;
  due_at?: number;
  /** The one person responsible. An open task without one is `awaiting_volunteer`. */
  assignee?: MemberId;
  /**
   * Who made `assignee` responsible, and at which log position. Present
   * exactly when `assignee` is; `by === assignee` when they took it themselves.
   */
  assigned?: { by: MemberId; seq: number };
  /** Other members helping, sorted. Never includes `assignee`. */
  volunteers: MemberId[];
  attachments: Attachment[];
  /** In seq order. */
  comments: TaskComment[];
  /** Bounded status history in seq order; the first entry is the creation. */
  history: TaskStatusChange[];
  created_by: MemberId;
  created_seq: number;
  updated_seq: number;
  /** Retention clock value when the task became done or cancelled. */
  closed_at?: number;
}

export type RejectReason =
  | "not_member"
  | "not_authorized"
  | "illegal_transition"
  | "capacity_full"
  | "unknown_target"
  | "malformed"
  | "unknown_type"
  | "stale_epoch"
  | "epoch_conflict"
  | "last_admin"
  | "already_exists"
  | "disabled"
  | "unsupported";

export interface RejectedOp {
  seq: number;
  op_id: OpId;
  author: Hex;
  type: string;
  reason: RejectReason;
}

export interface Clock {
  /** Last applied seq. */
  seq: number;
  /** Monotonic max of node receive times; the retention clock. */
  now: number;
}

export interface CommunityState {
  community: {
    crk: Hex;
    name: string;
    description: string;
    region?: string;
    /** WhatsApp group invite link (https://chat.whatsapp.com/…). */
    whatsapp?: string;
    policy: Policy;
    /** Set by `migrate` (§11.3): where the community lives now. */
    nodes?: string[];
    /**
     * Set by `disable` (§11.5): who (MSK) and when (node time). Writes stop;
     * the node deletes the community 30 days later unless another admin
     * sends `enable`.
     */
    disabled?: { by: Hex; at: number };
  };
  epoch: number;
  eak: Hex;
  admin_set: Hex[]; // sorted MSK public keys
  /**
   * Sorted MSK public keys of moderators (§9.2), set by `mod.set`. Absent
   * when there are none, so communities without moderators hash as before.
   */
  mod_set?: Hex[];
  ik: Hex;
  clock: Clock;
  members: Record<MemberId, MemberRecord>;
  events: Record<EventId, Event>;
  event_summaries: Record<EventId, EventSummary>;
  /** Tasks (§9.7). Absent when there are none, so communities without tasks hash as before. */
  tasks?: Record<TaskId, Task>;
  rejected_recent: RejectedOp[];
  /**
   * op_id → seq for dedupe within the log this device has replayed. Not part
   * of a snapshot: the node guarantees op_id uniqueness across compaction.
   */
  op_ids: Record<OpId, number>;
}

export type Outcome =
  | { status: "applied" }
  | { status: "opaque" }
  | { status: "duplicate"; seq: number }
  | { status: "rejected"; reason: RejectReason };
