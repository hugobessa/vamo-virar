// Stand-in for src/lib/context.tsx in Storybook: same hooks, fed by <ScenarioProvider>.
import { useSyncExternalStore } from "react";
import { NOW, buildStore, eligibilityFor, t, useScenario } from "./scenario";

export function useApp() {
  const s = useScenario();
  return { store: buildStore(s), calendar: s.calendar, t, locale: "pt-BR", version: 0 };
}

export function useCommunity(id: string | undefined) {
  const s = useScenario();
  return id ? s.entries.find((e) => e.id === id) : undefined;
}

export function useNow(): number {
  return NOW;
}

export function useEligibility(ev: { starts_at: number }) {
  return eligibilityFor(ev);
}

export function useCalendarService() {
  const { calendar } = useScenario();
  useSyncExternalStore(calendar.subscribe, calendar.getVersion, calendar.getVersion);
  return calendar;
}
