import { getLocales } from "expo-localization";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { pickLang, translator, type Lang, type StringKey } from "../model/i18n";
import { AppStore, type CommunityEntry } from "./store";

interface Ctx {
  store: AppStore;
  t: (k: StringKey) => string;
  lang: Lang;
  locale: string;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children, store: injected }: { children: ReactNode; store?: AppStore }) {
  const [store] = useState(() => injected ?? new AppStore());
  const locale = getLocales()[0]?.languageTag ?? "pt-BR";
  const lang = pickLang(getLocales()[0]?.languageCode);
  const value = useMemo(() => ({ store, t: translator(lang), lang, locale }), [store, lang, locale]);

  useEffect(() => {
    let alive = true;
    void store.init().then(() => alive && store.start());
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? store.start() : store.stop()));
    return () => {
      alive = false;
      sub.remove();
      store.stop();
    };
  }, [store]);

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
