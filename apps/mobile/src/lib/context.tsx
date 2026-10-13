import { probeAnswer } from "@vamo-virar/matching";
import { router } from "expo-router";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { fill, translator, type StringKey } from "../model/i18n";
import { NOTICE_TEXT, noticeSubject } from "../model/notifications";
import { MatchingService } from "./matching";
import * as notifications from "./notifications";
import { AppStore, type CommunityEntry } from "./store";

interface Ctx {
  store: AppStore;
  calendar: MatchingService;
  t: (k: StringKey) => string;
  locale: string;
}

/** The app is in Portuguese only; dates and numbers follow Brazilian conventions. */
const LOCALE = "pt-BR";

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children, store: injected }: { children: ReactNode; store?: AppStore }) {
  const [store] = useState(() => injected ?? new AppStore());
  const [calendar] = useState(() => new MatchingService());
  const value = useMemo(() => ({ store, calendar, t: translator(), locale: LOCALE }), [store, calendar]);

  useEffect(() => {
    // Answer "who could come?" on the person's behalf only when they turned
    // it on and the phone actually knows something (calendar or places).
    store.autoAnswer = async (entry) => {
      await calendar.load();
      if (!calendar.autoAnswer()) return;
      const state = entry.replica.canonical;
      for (const p of [...entry.replica.incomingProbes]) {
        const ev = state?.events[p.eventId];
        if (!ev) continue;
        const e = calendar.eligibilityFor({ starts_at: ev.starts_at, ends_at: ev.ends_at, area: ev.location.area });
        if (!e.known) continue;
        await entry.replica.answerProbe(p.probeId, probeAnswer(e.verdict));
      }
    };
    // System notifications are worded here, on the phone, from the decrypted state.
    const t = translator();
    store.notifier = {
      pushToken: () => notifications.pushToken(),
      announce: async (entry, notices) => {
        const state = entry.replica.canonical!;
        for (const n of notices) {
          const who = state.members[n.by]?.profile?.display_name ?? "?";
          const body = `${fill(t(NOTICE_TEXT[n.kind]), { name: who })} · ${noticeSubject(n)}`;
          await notifications.show(state.community.name, body, {
            community: entry.id,
            ...(n.task ? { task: n.task.task_id } : {}),
            ...(n.event ? { event: n.event.event_id } : {}),
          });
        }
      },
    };
    const stopNotifications = notifications.configure((target) => {
      if (target.task) router.push({ pathname: "/c/[id]/task/[tid]", params: { id: target.community, tid: target.task } });
      else if (target.event) router.push({ pathname: "/c/[id]/event/[eid]", params: { id: target.community, eid: target.event } });
      else router.push({ pathname: "/c/[id]/notifications", params: { id: target.community } });
    });
    let alive = true;
    void store.init().then(() => alive && store.start());
    void calendar.refreshStale();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        store.start();
        void calendar.refreshStale();
      } else {
        store.stop();
      }
    });
    return () => {
      alive = false;
      sub.remove();
      stopNotifications();
      store.stop();
    };
  }, [store, calendar]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx & { version: number } {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  const version = useSyncExternalStore(ctx.store.subscribe, ctx.store.getVersion, ctx.store.getVersion);
  return { ...ctx, version };
}

export function useCommunity(id: string | undefined): CommunityEntry | undefined {
  const { store } = useApp();
  return id ? store.get(id) : undefined;
}

/** Re-renders every minute so "upcoming" and relative times stay right. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Calendar + location fit for an event, computed on the phone. */
export function useEligibility(ev: { starts_at: number; ends_at: number; area: { lat_e4: number; lng_e4: number } }) {
  const { calendar } = useApp();
  useSyncExternalStore(calendar.subscribe, calendar.getVersion, calendar.getVersion);
  return calendar.eligibilityFor(ev);
}

export function useCalendarService(): MatchingService {
  const { calendar } = useApp();
  useSyncExternalStore(calendar.subscribe, calendar.getVersion, calendar.getVersion);
  return calendar;
}
