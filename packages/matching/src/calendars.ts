// Calendar sources, read-only, least privilege (architecture.md §18).
//
// Each adapter turns a provider's response into BusyIntervals and nothing
// else: no titles, descriptions, attendees or locations are kept, and for
// Google none are even requested. Requests go from the device straight to
// the provider; nothing passes through a community node.

import type { BusyInterval } from "./availability.js";

export type Fetch = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class CalendarError extends Error {
  constructor(
    readonly provider: "google" | "microsoft",
    readonly status: number,
    message: string,
  ) {
    super(message);
  }

  /** The token is no longer valid; the person must reconnect. */
  get needsReauth(): boolean {
    return this.status === 401;
  }
}

// ---------------------------------------------------------------------------
// Google Calendar: free/busy only.
// ---------------------------------------------------------------------------

export const GOOGLE = {
  /** Sees only busy intervals: no event titles, places or guests. */
  scopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
  discovery: {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    revocationEndpoint: "https://oauth2.googleapis.com/revoke",
  },
  freeBusyUrl: "https://www.googleapis.com/calendar/v3/freeBusy",
} as const;

export function parseGoogleFreeBusy(body: unknown, calendarId = "primary"): BusyInterval[] {
  const cal = (body as { calendars?: Record<string, { busy?: { start?: string; end?: string }[]; errors?: unknown[] }> })?.calendars?.[calendarId];
  if (!cal) throw new Error("free/busy response has no entry for the calendar");
  if (cal.errors?.length) throw new Error("free/busy could not be computed for the calendar");
  return (cal.busy ?? []).flatMap((b) => {
    const start = Date.parse(b.start ?? "");
    const end = Date.parse(b.end ?? "");
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ start, end, kind: "busy" as const, source: "google" }] : [];
  });
}

export async function fetchGoogleBusy(accessToken: string, from: number, to: number, fetchImpl: Fetch): Promise<BusyInterval[]> {
  const res = await fetchImpl(GOOGLE.freeBusyUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: "primary" }] }),
  });
  if (!res.ok) throw new CalendarError("google", res.status, `Google free/busy failed (${res.status})`);
  return parseGoogleFreeBusy(await res.json());
}

// ---------------------------------------------------------------------------
// Microsoft Outlook / 365 via Graph: calendarView with only time and status.
// ---------------------------------------------------------------------------

export const MICROSOFT = {
  /** ReadBasic: no event bodies or attachments; we further $select only times and status. */
  scopes: ["Calendars.ReadBasic", "offline_access"],
  discovery: {
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  },
  graph: "https://graph.microsoft.com/v1.0",
} as const;

interface GraphEvent {
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  showAs?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
}

/** Graph returns UTC times without an offset when no outlook.timezone is requested. */
function graphTime(s: string | undefined): number {
  if (!s) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
}

export function parseGraphEvents(events: readonly GraphEvent[]): BusyInterval[] {
  return events.flatMap((e) => {
    if (e.isCancelled) return [];
    const show = e.showAs ?? "busy";
    if (show === "free") return [];
    const kind = show === "tentative" || show === "unknown" ? ("tentative" as const) : ("busy" as const);
    const start = graphTime(e.start?.dateTime);
    const end = graphTime(e.end?.dateTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const i: BusyInterval = { start, end, kind, source: "microsoft" };
    if (e.isAllDay) i.allDay = true;
    return [i];
  });
}

export function graphCalendarViewUrl(from: number, to: number): string {
  const q = [
    `startDateTime=${encodeURIComponent(new Date(from).toISOString())}`,
    `endDateTime=${encodeURIComponent(new Date(to).toISOString())}`,
    `$select=start,end,showAs,isAllDay,isCancelled`,
    `$top=200`,
  ];
  return `${MICROSOFT.graph}/me/calendarView?${q.join("&")}`;
}

export async function fetchMicrosoftBusy(accessToken: string, from: number, to: number, fetchImpl: Fetch, maxPages = 20): Promise<BusyInterval[]> {
  const out: BusyInterval[] = [];
  let url: string | undefined = graphCalendarViewUrl(from, to);
  for (let page = 0; url && page < maxPages; page++) {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new CalendarError("microsoft", res.status, `Microsoft calendar failed (${res.status})`);
    const body = (await res.json()) as { value?: GraphEvent[]; "@odata.nextLink"?: string };
    out.push(...parseGraphEvents(body.value ?? []));
    const next = body["@odata.nextLink"];
    // Only follow pagination links back to Graph itself.
    url = next && next.startsWith(`${MICROSOFT.graph}/`) ? next : undefined;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Device calendars (EventKit on iOS, CalendarContract on Android) via
// expo-calendar. The app passes events in; only these fields are read.
// ---------------------------------------------------------------------------

export interface DeviceEvent {
  startDate: string | Date;
  endDate: string | Date;
  allDay?: boolean;
  availability?: string; // "busy" | "free" | "tentative" | "notSupported" | "unavailable"
  status?: string; // "canceled" | "confirmed" | "none" | "tentative"
}

export function parseDeviceEvents(events: readonly DeviceEvent[]): BusyInterval[] {
  return events.flatMap((e) => {
    if (e.status === "canceled" || e.availability === "free") return [];
    const start = new Date(e.startDate).getTime();
    const end = new Date(e.endDate).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const tentative = e.availability === "tentative" || e.status === "tentative";
    const i: BusyInterval = { start, end, kind: tentative ? "tentative" : "busy", source: "device" };
    if (e.allDay) i.allDay = true;
    return [i];
  });
}
