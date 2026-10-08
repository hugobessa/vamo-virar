import type { StringKey } from "./i18n";

export function syncStatusKey(input: {
  status: string;
  connectivity: "ok" | "offline";
  pending: number;
  /** Why the server is holding changes back, from the last sync. */
  blocked?: "moved" | "suspended" | "quota_exceeded" | undefined;
}): { key: StringKey; tone: "ok" | "warn" | "danger" | "neutral" } {
  if (input.status === "removed") return { key: "syncRemoved", tone: "danger" };
  if (input.status === "waiting_for_key") return { key: "syncWaitingAccess", tone: "warn" };
  if (input.connectivity === "offline") return { key: "syncOffline", tone: "warn" };
  if (input.blocked === "moved") return { key: "syncMoving", tone: "warn" };
  if (input.blocked === "suspended") return { key: "syncSuspended", tone: "warn" };
  if (input.blocked === "quota_exceeded") return { key: "syncFull", tone: "danger" };
  if (input.pending > 0) return { key: "syncSending", tone: "neutral" };
  return { key: "syncUpToDate", tone: "ok" };
}
