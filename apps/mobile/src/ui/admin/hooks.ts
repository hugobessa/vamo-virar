// Shared by the sections of the administration screen: the join requests
// (fetched from the server, not part of the shared state) and a runner for
// admin actions that keeps one busy key, one error and one notice.

import type { PendingJoin } from "@vamo-virar/sync";
import { useCallback, useEffect, useState } from "react";
import { LayoutAnimation } from "react-native";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import type { Replica } from "@vamo-virar/sync";
import { errorText } from "../../model/errors";
import { useReducedMotion } from "../theme";

/**
 * The people waiting to be let in, for a moderator. Reloaded after every
 * sync, so a request that arrived while the screen is open shows up; `null`
 * until the first answer or when the server could not be asked.
 */
export function useJoinRequests(entry: CommunityEntry | undefined, enabled: boolean): { requests: PendingJoin[] | null; reload: () => Promise<void> } {
  const [requests, setRequests] = useState<PendingJoin[] | null>(null);
  const r = entry?.replica;
  const reload = useCallback(async () => {
    if (!enabled || !r) return;
    try {
      setRequests(await r.joinRequests());
    } catch {
      setRequests(null);
    }
  }, [enabled, r]);
  const since = entry?.lastSync ?? null;
  useEffect(() => {
    void reload();
  }, [reload, since]);
  return { requests, reload };
}

export interface AdminRunner {
  /** The key of the action in flight, to show one spinner. */
  busy: string | null;
  error: string | null;
  notice: string | null;
  setNotice: (s: string | null) => void;
  /** Runs an admin action; true when it went through. The error, if any, is kept for the screen. */
  run: (key: string, f: (r: Replica) => Promise<unknown>, after?: () => Promise<void>) => Promise<boolean>;
}

export function useAdminRunner(entry: CommunityEntry): AdminRunner {
  const { store } = useApp();
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, f: (r: Replica) => Promise<unknown>, after?: () => Promise<void>) => {
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        await store.admin(entry.id, f);
        // A handled item slides out of its list.
        if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        await after?.();
        return true;
      } catch (e) {
        setError(errorText(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [store, entry.id, reduced],
  );
  return { busy, error, notice, setNotice, run };
}
