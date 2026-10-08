// Calendar availability, computed on the device (architecture.md §19).
// Input: the event's time window and the person's busy intervals from any
// calendar source. Output: a verdict and the local reasons for it. Neither
// the intervals nor the reasons are ever sent anywhere.

export type BusyKind = "busy" | "tentative";

export interface BusyInterval {
  start: number; // ms since epoch, UTC
  end: number;
  kind: BusyKind;
  allDay?: boolean;
  /** Which source it came from, for the person's own explanation. */
  source?: string;
}

export interface AvailabilityPrefs {
  /** Minimum free gap wanted before and after the event, in minutes. */
  bufferMinutes: number;
  /** Whether an all-day calendar entry makes the whole day unavailable. */
  allDayBlocks: boolean;
}

export const DEFAULT_PREFS: AvailabilityPrefs = { bufferMinutes: 30, allDayBlocks: false };

export type Verdict = "available" | "maybe" | "unavailable";

export type Reason =
  | { kind: "conflict"; interval: BusyInterval }
  | { kind: "tentative"; interval: BusyInterval }
  | { kind: "all_day"; interval: BusyInterval }
  | { kind: "too_close"; interval: BusyInterval; gapMinutes: number };

export interface Availability {
  verdict: Verdict;
  reasons: Reason[];
}

const RANK: Record<Verdict, number> = { available: 0, maybe: 1, unavailable: 2 };

export function worse(a: Verdict, b: Verdict): Verdict {
  return RANK[a] >= RANK[b] ? a : b;
}

function valid(i: BusyInterval): boolean {
  return Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start;
}

export function availability(
  window: { start: number; end: number },
  busy: readonly BusyInterval[],
  prefs: AvailabilityPrefs = DEFAULT_PREFS,
): Availability {
  const reasons: Reason[] = [];
  let verdict: Verdict = "available";
  const buffer = Math.max(0, prefs.bufferMinutes) * 60_000;

  for (const i of busy) {
    if (!valid(i)) continue;
    const overlaps = i.start < window.end && i.end > window.start;
    if (overlaps) {
      if (i.allDay) {
        reasons.push({ kind: "all_day", interval: i });
        verdict = worse(verdict, prefs.allDayBlocks && i.kind === "busy" ? "unavailable" : "maybe");
      } else if (i.kind === "tentative") {
        reasons.push({ kind: "tentative", interval: i });
        verdict = worse(verdict, "maybe");
      } else {
        reasons.push({ kind: "conflict", interval: i });
        verdict = worse(verdict, "unavailable");
      }
      continue;
    }
    if (i.allDay || buffer === 0) continue;
    const gap = i.end <= window.start ? window.start - i.end : i.start - window.end;
    if (gap < buffer) {
      reasons.push({ kind: "too_close", interval: i, gapMinutes: Math.floor(gap / 60_000) });
      verdict = worse(verdict, "maybe");
    }
  }

  reasons.sort((a, b) => a.interval.start - b.interval.start);
  return { verdict, reasons };
}

/** Merges overlapping intervals of the same kind (and all-day flag); useful before caching. */
export function normalize(busy: readonly BusyInterval[]): BusyInterval[] {
  const groups = new Map<string, BusyInterval[]>();
  for (const i of busy) {
    if (!valid(i)) continue;
    const key = `${i.kind}:${i.allDay ? 1 : 0}`;
    const g = groups.get(key) ?? [];
    g.push(i);
    groups.set(key, g);
  }
  const out: BusyInterval[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.start - b.start || a.end - b.end);
    let cur: BusyInterval | null = null;
    for (const i of g) {
      if (cur && i.start <= cur.end) {
        cur.end = Math.max(cur.end, i.end);
      } else {
        cur = { ...i };
        out.push(cur);
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
