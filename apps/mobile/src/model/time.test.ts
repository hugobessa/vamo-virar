import { describe, expect, it } from "vitest";
import { formatDateInput, parseDurationHours, parseLocal } from "./time";

describe("date entry", () => {
  it("parses local dates and times", () => {
    const ms = parseLocal("18/10/2026", "18:30");
    const d = new Date(ms!);
    expect([d.getDate(), d.getMonth(), d.getFullYear(), d.getHours(), d.getMinutes()]).toEqual([18, 9, 2026, 18, 30]);
    expect(parseLocal("18/10/2026", "18h30")).toBe(ms);
    expect(formatDateInput(ms!)).toBe("18/10/2026");
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
