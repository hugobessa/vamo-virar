import { getLocales } from "expo-localization";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { pickLang, translator, type Lang, type StringKey } from "../model/i18n";
import { CalendarService } from "./calendar";
import { AppStore, type CommunityEntry } from "./store";

interface Ctx {
  store: AppStore;
  calendar: CalendarService;
  t: (k: StringKey) => string;
  lang: Lang;
  locale: string;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children, store: injected }: { children: ReactNode; store?: AppStore }) {
  const [store] = useState(() => injected ?? new AppStore());
  const [calendar] = useState(() => new CalendarService());
  const locale = getLocales()[0]?.languageTag ?? "pt-BR";
  const lang = pickLang(getLocales()[0]?.languageCode);
  const value = useMemo(() => ({ store, calendar, t: translator(lang), lang, locale }), [store, calendar, lang, locale]);

  useEffect(() => {
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

/** Calendar availability for a time window, or null if no calendar covers it. */
export function useAvailability(window: { start: number; end: number }) {
  const { calendar } = useApp();
  useSyncExternalStore(calendar.subscribe, calendar.getVersion, calendar.getVersion);
  return calendar.check(window);
}

export function useCalendarService(): CalendarService {
  const { calendar } = useApp();
  useSyncExternalStore(calendar.subscribe, calendar.getVersion, calendar.getVersion);
  return calendar;
}
