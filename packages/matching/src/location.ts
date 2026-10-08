// Location matching on the device (architecture.md §17, Phase 7).
//
// People choose reference points ("Home", "Work", "São Paulo next week")
// with a radius, optionally limited to dates. A one-off "where I am now"
// reading can be added as a short-lived point. Nothing here leaves the
// device; precise GPS history is never kept.

import { worse, type Verdict } from "./availability.js";

export interface Area {
  lat_e4: number;
  lng_e4: number;
}

export interface ReferencePoint extends Area {
  id: string;
  label: string;
  radiusKm: number;
  /** Optional validity window (ms): e.g. a trip next week. */
  activeFrom?: number;
  activeTo?: number;
}

export interface LocationPrefs {
  points: ReferencePoint[];
  /** Average door-to-door speed used to estimate travel time. */
  travelKmh: number;
  /** Fixed overhead per trip (getting ready, waiting), minutes. */
  travelOverheadMinutes: number;
}

export const DEFAULT_LOCATION_PREFS: LocationPrefs = { points: [], travelKmh: 25, travelOverheadMinutes: 10 };

const EARTH_KM = 6371.0088;
const rad = (e4: number) => (e4 / 1e4) * (Math.PI / 180);

/** Great-circle distance in km between two areas. */
export function distanceKm(a: Area, b: Area): number {
  const dLat = rad(b.lat_e4 - a.lat_e4);
  const dLng = rad(b.lng_e4 - a.lng_e4);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat_e4)) * Math.cos(rad(b.lat_e4)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function travelMinutes(km: number, prefs: Pick<LocationPrefs, "travelKmh" | "travelOverheadMinutes">): number {
  return Math.round((km / Math.max(1, prefs.travelKmh)) * 60 + prefs.travelOverheadMinutes);
}

export function activePoints(prefs: LocationPrefs, at: number): ReferencePoint[] {
  return prefs.points.filter((p) => (p.activeFrom === undefined || p.activeFrom <= at) && (p.activeTo === undefined || p.activeTo >= at));
}

export type LocationVerdict = "near" | "edge" | "far" | "unknown";

export interface LocationFit {
  verdict: LocationVerdict;
  /** The reference point the event is closest to, relative to its radius. */
  point?: ReferencePoint;
  distanceKm?: number;
  travelMinutes?: number;
}

/**
 * How the event's area relates to the person's reference points active at
 * the event's start. Dated points (a trip) take precedence over undated
 * ones when both are active, because they say where the person will be.
 */
export function locationFit(area: Area, startsAt: number, prefs: LocationPrefs): LocationFit {
  let pts = activePoints(prefs, startsAt);
  const dated = pts.filter((p) => p.activeFrom !== undefined || p.activeTo !== undefined);
  if (dated.length) pts = dated;
  if (pts.length === 0) return { verdict: "unknown" };
  let best: { p: ReferencePoint; d: number; ratio: number } | null = null;
  for (const p of pts) {
    const d = distanceKm(p, area);
    const ratio = d / Math.max(0.1, p.radiusKm);
    if (!best || ratio < best.ratio) best = { p, d, ratio };
  }
  const { p, d, ratio } = best!;
  const verdict: LocationVerdict = ratio <= 1 ? "near" : ratio <= 1.5 ? "edge" : "far";
  return { verdict, point: p, distanceKm: d, travelMinutes: travelMinutes(d, prefs) };
}

export function locationVerdict(fit: LocationFit): Verdict {
  switch (fit.verdict) {
    case "near":
    case "unknown":
      return "available";
    case "edge":
      return "maybe";
    case "far":
      return "unavailable";
  }
}

export { worse };
