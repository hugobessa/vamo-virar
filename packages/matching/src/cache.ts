// Busy intervals from every connected calendar, kept on the device.
// Each source records which window it covers, so "free" is never claimed
// for a time no calendar was asked about.

import { availability, normalize, type Availability, type AvailabilityPrefs, type BusyInterval } from "./availability.js";

export interface SourceSnapshot {
  fetchedAt: number;
  from: number;
  to: number;
  intervals: BusyInterval[];
}

export type CacheData = Record<string, SourceSnapshot>;

export class BusyCache {
  constructor(private data: CacheData = {}) {}

  set(source: string, snap: SourceSnapshot): void {
    this.data[source] = { ...snap, intervals: normalize(snap.intervals) };
  }

  remove(source: string): void {
    delete this.data[source];
  }

  sources(): string[] {
    return Object.keys(this.data);
  }

  snapshot(source: string): SourceSnapshot | undefined {
    return this.data[source];
  }

  /** True if every connected source has fetched a window containing [start, end]. */
  covers(start: number, end: number): boolean {
    const snaps = Object.values(this.data);
    return snaps.length > 0 && snaps.every((s) => s.from <= start && s.to >= end);
  }

  intervals(): BusyInterval[] {
    return Object.values(this.data).flatMap((s) => s.intervals);
  }

  /** Availability for a window, or null when no connected calendar covers it. */
  check(window: { start: number; end: number }, prefs?: AvailabilityPrefs): Availability | null {
    if (!this.covers(window.start, window.end)) return null;
    return availability(window, this.intervals(), prefs);
  }

  toJSON(): CacheData {
    return this.data;
  }
}
