import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { availability, normalize, worse, type BusyInterval, type Verdict } from "../src/availability.js";
import { BusyCache } from "../src/cache.js";

const H = 3_600_000;
const M = 60_000;
const ev = { start: 18 * H, end: 21 * H };
const busy = (start: number, end: number, extra: Partial<BusyInterval> = {}): BusyInterval => ({ start, end, kind: "busy", ...extra });
const prefs = { bufferMinutes: 30, allDayBlocks: false };

describe("availability", () => {
  it("free when nothing is near", () => {
    expect(availability(ev, [busy(9 * H, 12 * H)], prefs).verdict).toBe("available");
  });

  it("unavailable on a real conflict", () => {
    const a = availability(ev, [busy(17 * H, 19 * H)], prefs);
    expect(a.verdict).toBe("unavailable");
    expect(a.reasons[0]!.kind).toBe("conflict");
  });

  it("maybe on tentative overlaps and tight gaps", () => {
    expect(availability(ev, [busy(19 * H, 20 * H, { kind: "tentative" })], prefs).verdict).toBe("maybe");
    const close = availability(ev, [busy(16 * H, 18 * H - 10 * M)], prefs);
    expect(close.verdict).toBe("maybe");
    expect(close.reasons[0]).toMatchObject({ kind: "too_close", gapMinutes: 10 });
    expect(availability(ev, [busy(16 * H, 18 * H - 10 * M)], { ...prefs, bufferMinutes: 0 }).verdict).toBe("available");
  });

  it("touching intervals do not conflict", () => {
    expect(availability(ev, [busy(16 * H, 18 * H)], { ...prefs, bufferMinutes: 0 }).verdict).toBe("available");
  });

  it("all-day entries: maybe by default, unavailable when the person says so", () => {
    const day = busy(0, 24 * H, { allDay: true });
    expect(availability(ev, [day], prefs).verdict).toBe("maybe");
    expect(availability(ev, [day], { ...prefs, allDayBlocks: true }).verdict).toBe("unavailable");
  });

  it("ignores malformed intervals", () => {
    expect(availability(ev, [busy(NaN, 1), busy(20 * H, 19 * H)], prefs).verdict).toBe("available");
  });

  it("normalize merges overlapping intervals of the same kind", () => {
    expect(normalize([busy(1, 5), busy(4, 8), busy(10, 12), busy(3, 6, { kind: "tentative" })])).toEqual([
      busy(1, 8),
      busy(3, 6, { kind: "tentative" }),
      busy(10, 12),
    ]);
  });
});

const interval = fc
  .record({ start: fc.integer({ min: 0, max: 48 * 60 }), len: fc.integer({ min: 1, max: 600 }), kind: fc.constantFrom("busy" as const, "tentative" as const), allDay: fc.boolean() })
  .map(({ start, len, kind, allDay }) => busy(start * M, (start + len) * M, { kind, ...(allDay ? { allDay } : {}) }));
const RANK: Record<Verdict, number> = { available: 0, maybe: 1, unavailable: 2 };

describe("properties", () => {
  it("adding commitments never makes someone more available", () => {
    fc.assert(
      fc.property(fc.array(interval, { maxLength: 8 }), interval, fc.boolean(), (list, extra, blocks) => {
        const p = { bufferMinutes: 30, allDayBlocks: blocks };
        expect(RANK[availability(ev, [...list, extra], p).verdict]).toBeGreaterThanOrEqual(RANK[availability(ev, list, p).verdict]);
      }),
    );
  });

  it("order of intervals does not matter", () => {
    fc.assert(
      fc.property(fc.array(interval, { maxLength: 8 }), (list) => {
        expect(availability(ev, [...list].reverse(), prefs).verdict).toBe(availability(ev, list, prefs).verdict);
      }),
    );
  });

  it("normalizing does not change the verdict", () => {
    fc.assert(
      fc.property(fc.array(interval, { maxLength: 8 }), (list) => {
        expect(availability(ev, normalize(list), prefs).verdict).toBe(availability(ev, list, prefs).verdict);
      }),
    );
  });

  it("worse is a max", () => {
    expect(worse("available", "maybe")).toBe("maybe");
    expect(worse("unavailable", "maybe")).toBe("unavailable");
  });
});

describe("BusyCache", () => {
  it("only answers for covered windows, across all sources", () => {
    const c = new BusyCache();
    expect(c.check(ev)).toBeNull(); // no calendars connected: unknown, not free
    c.set("device", { fetchedAt: 0, from: 0, to: 30 * H, intervals: [busy(19 * H, 20 * H)] });
    expect(c.check(ev)!.verdict).toBe("unavailable");
    c.set("google", { fetchedAt: 0, from: 20 * H, to: 40 * H, intervals: [] });
    expect(c.check(ev)).toBeNull(); // google has not looked at 18:00–20:00
    c.remove("google");
    expect(new BusyCache(JSON.parse(JSON.stringify(c.toJSON()))).check(ev)!.verdict).toBe("unavailable");
  });
});
