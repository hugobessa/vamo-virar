import { describe, expect, it } from "vitest";
import {
  CalendarError,
  fetchGoogleBusy,
  fetchMicrosoftBusy,
  GOOGLE,
  graphCalendarViewUrl,
  MICROSOFT,
  parseDeviceEvents,
  parseGoogleFreeBusy,
  parseGraphEvents,
  type Fetch,
} from "../src/calendars.js";

function recorder(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; init?: Parameters<Fetch>[1] }[] = [];
  const f: Fetch = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const r = responses.shift() ?? { status: 500, body: {} };
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
  };
  return { f, calls };
}

describe("least privilege", () => {
  it("Google asks only for free/busy, Microsoft only for basic calendar reads", () => {
    expect(GOOGLE.scopes).toEqual(["https://www.googleapis.com/auth/calendar.freebusy"]);
    expect(MICROSOFT.scopes).toEqual(["Calendars.ReadBasic", "offline_access"]);
  });

  it("Graph requests select only times and status", () => {
    const url = graphCalendarViewUrl(0, 86_400_000);
    expect(url).toContain("$select=start,end,showAs,isAllDay,isCancelled");
    expect(url).not.toMatch(/subject|body|attendees|location/);
  });
});

describe("Google", () => {
  it("parses busy blocks", () => {
    const body = { calendars: { primary: { busy: [{ start: "2026-10-18T20:00:00Z", end: "2026-10-18T21:00:00Z" }, { start: "bad", end: "x" }] } } };
    expect(parseGoogleFreeBusy(body)).toEqual([{ start: Date.parse("2026-10-18T20:00:00Z"), end: Date.parse("2026-10-18T21:00:00Z"), kind: "busy", source: "google" }]);
    expect(() => parseGoogleFreeBusy({ calendars: { primary: { errors: [{ reason: "notFound" }] } } })).toThrow();
  });

  it("sends a free/busy query for the primary calendar with the bearer token", async () => {
    const { f, calls } = recorder([{ body: { calendars: { primary: { busy: [] } } } }]);
    await fetchGoogleBusy("tok", 0, 1000, f);
    expect(calls[0]!.url).toBe(GOOGLE.freeBusyUrl);
    expect(calls[0]!.init!.headers!.authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({ timeMin: "1970-01-01T00:00:00.000Z", timeMax: "1970-01-01T00:00:01.000Z", items: [{ id: "primary" }] });
  });

  it("signals reauthorisation on 401", async () => {
    const { f } = recorder([{ status: 401, body: {} }]);
    await expect(fetchGoogleBusy("tok", 0, 1, f)).rejects.toSatisfy((e: unknown) => e instanceof CalendarError && e.needsReauth);
  });
});

describe("Microsoft", () => {
  it("maps showAs and skips free and cancelled events", () => {
    const out = parseGraphEvents([
      { start: { dateTime: "2026-10-18T20:00:00.0000000" }, end: { dateTime: "2026-10-18T21:00:00.0000000" }, showAs: "busy" },
      { start: { dateTime: "2026-10-18T22:00:00" }, end: { dateTime: "2026-10-18T23:00:00" }, showAs: "tentative" },
      { start: { dateTime: "2026-10-19T00:00:00" }, end: { dateTime: "2026-10-20T00:00:00" }, showAs: "oof", isAllDay: true },
      { start: { dateTime: "2026-10-18T10:00:00" }, end: { dateTime: "2026-10-18T11:00:00" }, showAs: "free" },
      { start: { dateTime: "2026-10-18T12:00:00" }, end: { dateTime: "2026-10-18T13:00:00" }, isCancelled: true },
    ]);
    expect(out.map((i) => [new Date(i.start).toISOString(), i.kind, !!i.allDay])).toEqual([
      ["2026-10-18T20:00:00.000Z", "busy", false],
      ["2026-10-18T22:00:00.000Z", "tentative", false],
      ["2026-10-19T00:00:00.000Z", "busy", true],
    ]);
  });

  it("follows pagination only back to Graph", async () => {
    const page = (next?: string) => ({ body: { value: [{ start: { dateTime: "2026-10-18T20:00:00" }, end: { dateTime: "2026-10-18T21:00:00" } }], ...(next ? { "@odata.nextLink": next } : {}) } });
    const ok = recorder([page(`${MICROSOFT.graph}/me/calendarView?$skip=200`), page()]);
    expect(await fetchMicrosoftBusy("t", 0, 1, ok.f)).toHaveLength(2);
    expect(ok.calls).toHaveLength(2);
    const evil = recorder([page("https://evil.example/steal"), page()]);
    expect(await fetchMicrosoftBusy("t", 0, 1, evil.f)).toHaveLength(1);
    expect(evil.calls).toHaveLength(1);
  });
});

describe("device calendars", () => {
  it("reads only time, all-day, availability and status", () => {
    const out = parseDeviceEvents([
      { startDate: "2026-10-18T20:00:00Z", endDate: "2026-10-18T21:00:00Z", availability: "busy", status: "confirmed" },
      { startDate: new Date("2026-10-18T22:00:00Z"), endDate: new Date("2026-10-18T23:00:00Z"), availability: "tentative" },
      { startDate: "2026-10-18T09:00:00Z", endDate: "2026-10-18T10:00:00Z", availability: "free" },
      { startDate: "2026-10-18T11:00:00Z", endDate: "2026-10-18T12:00:00Z", status: "canceled" },
      { startDate: "2026-10-19T00:00:00Z", endDate: "2026-10-20T00:00:00Z", allDay: true },
    ]);
    expect(out.map((i) => [i.kind, !!i.allDay])).toEqual([
      ["busy", false],
      ["tentative", false],
      ["busy", true],
    ]);
  });
});
