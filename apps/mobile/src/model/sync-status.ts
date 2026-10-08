import type { StringKey } from "./i18n";

export function syncStatusKey(input: {
  status: string;
  connectivity: "ok" | "offline";
  pending: number;
}): { key: StringKey; tone: "ok" | "warn" | "danger" | "neutral" } {
  if (input.status === "removed") return { key: "syncRemoved", tone: "danger" };
  if (input.status === "waiting_for_key") return { key: "syncWaitingAccess", tone: "warn" };
  if (input.connectivity === "offline") return { key: "syncOffline", tone: "warn" };
  if (input.pending > 0) return { key: "syncSending", tone: "neutral" };
  return { key: "syncUpToDate", tone: "ok" };
}
