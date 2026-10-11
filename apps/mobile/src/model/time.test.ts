import { describe, expect, it } from "vitest";
import { dateBlock, dayKey, formatDateInput, formatHours, formatTimeInput, groupByDay, parseDurationHours, parseLocal } from "./time";

describe("date entry", () => {
  it("parses local dates and times", () => {
    const ms = parseLocal("18/10/2026", "18:30");
    const d = new Date(ms!);
    expect([d.getDate(), d.getMonth(), d.getFullYear(), d.getHours(), d.getMinutes()]).toEqual([18, 9, 2026, 18, 30]);
    expect(parseLocal("18/10/2026", "18h30")).toBe(ms);
    expect(formatDateInput(ms!)).toBe("18/10/2026");
    expect(formatTimeInput(ms!)).toBe("18:30");
  });

  it("rejects impossible values", () => {
    for (const [d, t] of [["31/02/2026", "10:00"], ["10/13/2026", "10:00"], ["10/10/2026", "24:00"], ["10-10-2026", "10:00"], ["", ""]]) {
      expect(parseLocal(d!, t!)).toBeNull();
    }
  });

  it("parses durations with comma or dot", () => {
    expect(parseDurationHours("1,5")).toBe(5_400_000);
    expect(parseDurationHours("2")).toBe(7_200_000);
    expect(parseDurationHours("0")).toBeNull();
    expect(parseDurationHours("abc")).toBeNull();
  });
});

describe("event cards", () => {
  const tz = "America/Recife";
  const now = new Date("2026-10-10T15:00:00-03:00").getTime();
  const H = 3_600_000;
  const words = { today: "Hoje", tomorrow: "Amanhã" };

  it("labels today and tomorrow, then falls back to the date", () => {
    expect(dateBlock(now + 2 * H, now, "pt-BR", tz, words).heading).toBe("Hoje");
    expect(dateBlock(now + 20 * H, now, "pt-BR", tz, words).heading).toBe("Amanhã");
    const later = dateBlock(now + 5 * 24 * H, now, "pt-BR", tz, words);
    expect(later.heading).toMatch(/15/);
    expect(later.day).toBe("15");
    expect(later.weekday.length).toBeGreaterThan(0);
  });

  it("shows the hours in the event's time zone", () => {
    expect(formatHours(now, now + 3 * H, "pt-BR", tz)).toBe("15:00 – 18:00");
  });

  it("groups consecutive events by calendar day", () => {
    const ev = (starts_at: number) => ({ starts_at, tz });
    const groups = groupByDay([ev(now), ev(now + 2 * H), ev(now + 30 * H), ev(now + 60 * H)]);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 1]);
    expect(groups[0]!.key).toBe(dayKey(now, tz));
    expect(dayKey(now, tz)).toBe("2026-10-10");
  });
});
