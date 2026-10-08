import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { eligibility, probeAnswer } from "../src/eligibility.js";
import { distanceKm, locationFit, travelMinutes, type LocationPrefs, type ReferencePoint } from "../src/location.js";

const RECIFE = { lat_e4: -80_476, lng_e4: -348_770 };
const OLINDA = { lat_e4: -80_089, lng_e4: -348_553 };
const SAO_PAULO = { lat_e4: -235_505, lng_e4: -466_333 };
const DAY = 86_400_000;
const H = 3_600_000;

const home: ReferencePoint = { id: "home", label: "Casa", ...RECIFE, radiusKm: 15 };
const prefs = (points: ReferencePoint[]): LocationPrefs => ({ points, travelKmh: 25, travelOverheadMinutes: 10 });

describe("distances", () => {
  it("are about right", () => {
    expect(distanceKm(RECIFE, OLINDA)).toBeGreaterThan(4);
    expect(distanceKm(RECIFE, OLINDA)).toBeLessThan(6);
    const rs = distanceKm(RECIFE, SAO_PAULO);
    expect(rs).toBeGreaterThan(2000);
    expect(rs).toBeLessThan(2200);
    expect(distanceKm(RECIFE, RECIFE)).toBe(0);
  });

  it("are symmetric and satisfy the triangle inequality", () => {
    const area = fc.record({ lat_e4: fc.integer({ min: -800_000, max: 800_000 }), lng_e4: fc.integer({ min: -1_800_000, max: 1_800_000 }) });
    fc.assert(
      fc.property(area, area, area, (a, b, c) => {
        expect(Math.abs(distanceKm(a, b) - distanceKm(b, a))).toBeLessThan(1e-6);
        expect(distanceKm(a, c)).toBeLessThanOrEqual(distanceKm(a, b) + distanceKm(b, c) + 1e-6);
      }),
    );
  });

  it("travel time grows with distance", () => {
    expect(travelMinutes(0, prefs([]))).toBe(10);
    expect(travelMinutes(25, prefs([]))).toBe(70);
  });
});

describe("location fit", () => {
  it("near, edge, far and unknown", () => {
    expect(locationFit(OLINDA, 0, prefs([home])).verdict).toBe("near");
    expect(locationFit(OLINDA, 0, prefs([{ ...home, radiusKm: 4 }])).verdict).toBe("edge");
    expect(locationFit(SAO_PAULO, 0, prefs([home])).verdict).toBe("far");
    expect(locationFit(SAO_PAULO, 0, prefs([])).verdict).toBe("unknown");
  });

  it("a dated trip takes precedence over home while it lasts", () => {
    const trip: ReferencePoint = { id: "trip", label: "Viagem", ...SAO_PAULO, radiusKm: 30, activeFrom: 10 * DAY, activeTo: 17 * DAY };
    const p = prefs([home, trip]);
    expect(locationFit(SAO_PAULO, 12 * DAY, p).verdict).toBe("near");
    expect(locationFit(RECIFE, 12 * DAY, p).verdict).toBe("far"); // away that week
    expect(locationFit(RECIFE, 20 * DAY, p).verdict).toBe("near"); // back home
  });
});

describe("eligibility", () => {
  const ev = { starts_at: 18 * H, ends_at: 21 * H, area: OLINDA };
  const calendarPrefs = { bufferMinutes: 15, allDayBlocks: false };

  it("travel time widens the calendar buffer", () => {
    const busy = [{ start: 16 * H, end: 17.5 * H, kind: "busy" as const }]; // 30 min before
    const close = eligibility(ev, { busy, calendarPrefs, locationPrefs: prefs([home]) });
    // ~5 km at 25 km/h + 10 min ≈ 22 min < 30: fine.
    expect(close.verdict).toBe("available");
    const farHome = { ...home, lat_e4: -82_833, lng_e4: -359_761, radiusKm: 200 }; // Caruaru, ~120 km
    const far = eligibility(ev, { busy, calendarPrefs, locationPrefs: prefs([farHome]) });
    expect(far.verdict).toBe("maybe");
    expect(far.calendar!.reasons[0]!.kind).toBe("too_close");
  });

  it("no calendar and no places: not a no, but marked unknown so the person is asked", () => {
    const e = eligibility(ev, { busy: null, calendarPrefs, locationPrefs: prefs([]) });
    expect(e.verdict).toBe("available");
    expect(e.known).toBe(false);
    expect(eligibility(ev, { busy: [], calendarPrefs, locationPrefs: prefs([]) }).known).toBe(true);
  });

  it("maps to probe answers", () => {
    expect(probeAnswer("available")).toBe("eligible");
    expect(probeAnswer("maybe")).toBe("maybe");
    expect(probeAnswer("unavailable")).toBe("not_eligible");
  });
});
