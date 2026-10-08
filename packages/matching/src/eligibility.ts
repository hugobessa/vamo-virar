// The combined, on-device answer to "can I make this event?": calendar and
// location together. Travel time to the event widens the calendar buffer.

import { availability, worse, type Availability, type AvailabilityPrefs, type BusyInterval, type Verdict } from "./availability.js";
import { locationFit, locationVerdict, type Area, type LocationFit, type LocationPrefs } from "./location.js";

export interface EventShape {
  starts_at: number;
  ends_at: number;
  area: Area;
}

export interface Eligibility {
  verdict: Verdict;
  /** False when neither a calendar nor a reference point says anything: ask the person. */
  known: boolean;
  calendar: Availability | null;
  location: LocationFit;
}

export function eligibility(
  ev: EventShape,
  input: {
    /** null: no connected calendar covers the event. */
    busy: BusyInterval[] | null;
    calendarPrefs: AvailabilityPrefs;
    locationPrefs: LocationPrefs;
  },
): Eligibility {
  const location = locationFit(ev.area, ev.starts_at, input.locationPrefs);
  const buffer = Math.max(input.calendarPrefs.bufferMinutes, location.travelMinutes ?? 0);
  const calendar = input.busy ? availability({ start: ev.starts_at, end: ev.ends_at }, input.busy, { ...input.calendarPrefs, bufferMinutes: buffer }) : null;
  let verdict = locationVerdict(location);
  if (calendar) verdict = worse(verdict, calendar.verdict);
  return { verdict, known: calendar !== null || location.verdict !== "unknown", calendar, location };
}

/** What a probe reply says (§10.4): a verdict, nothing else. */
export type ProbeAnswer = "eligible" | "maybe" | "not_eligible";

export function probeAnswer(v: Verdict): ProbeAnswer {
  return v === "available" ? "eligible" : v === "maybe" ? "maybe" : "not_eligible";
}
