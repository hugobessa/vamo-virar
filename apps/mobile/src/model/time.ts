// Date and time entry that works the same on every platform: plain text
// fields in the person's local time, validated here. Native screens offer
// the system pickers on top (ui/DateTimeFields), writing the same strings.

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDateInput(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses "DD/MM/YYYY" + "HH:MM" in the device's local time zone. */
export function parseLocal(date: string, time: string): number | null {
  const dm = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(date);
  const tm = /^\s*(\d{1,2})[:h](\d{2})\s*$/.exec(time);
  if (!dm || !tm) return null;
  const [day, month, year] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [hour, minute] = [Number(tm[1]), Number(tm[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || year < 2000 || year > 2200) return null;
  const d = new Date(year, month - 1, day, hour, minute);
  // Reject rollovers such as 31/02.
  if (d.getDate() !== day || d.getMonth() !== month - 1) return null;
  return d.getTime();
}

export function parseDurationHours(s: string): number | null {
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 14) return null;
  return Math.round(n * 3_600_000);
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function formatWhen(startsAt: number, endsAt: number, locale: string, tz: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz };
  try {
    const start = new Intl.DateTimeFormat(locale, opts).format(new Date(startsAt));
    const end = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(endsAt));
    return `${start} – ${end}`;
  } catch {
    return new Date(startsAt).toISOString();
  }
}

/** "10:00 – 13:00" in the event's time zone. */
export function formatHours(startsAt: number, endsAt: number, locale: string, tz: string): string {
  try {
    const f = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz });
    return `${f.format(new Date(startsAt))} – ${f.format(new Date(endsAt))}`;
  } catch {
    return "";
  }
}

/** The calendar day (YYYY-MM-DD) of an instant in a time zone, for grouping. */
export function dayKey(ms: number, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(new Date(ms));
    return parts; // en-CA formats as YYYY-MM-DD
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * The parts of a date block on an event card: "11" over "dom." and a heading
 * for the day ("Hoje", "Amanhã", or "dom., 11 de out."). `today` and
 * `tomorrow` are the words to use for those two days.
 */
export function dateBlock(ms: number, now: number, locale: string, tz: string, words: { today: string; tomorrow: string }): { day: string; weekday: string; heading: string } {
  try {
    const d = new Date(ms);
    const day = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: tz }).format(d);
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: tz }).format(d);
    const key = dayKey(ms, tz);
    const long = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(d);
    const heading = key === dayKey(now, tz) ? words.today : key === dayKey(now + 86_400_000, tz) ? words.tomorrow : long;
    return { day, weekday, heading };
  } catch {
    const iso = new Date(ms).toISOString();
    return { day: iso.slice(8, 10), weekday: "", heading: iso.slice(0, 10) };
  }
}

/** Groups events by calendar day, in the order given. */
export function groupByDay<T extends { starts_at: number; tz: string }>(events: T[]): { key: string; first: T; items: T[] }[] {
  const groups: { key: string; first: T; items: T[] }[] = [];
  for (const e of events) {
    const key = dayKey(e.starts_at, e.tz);
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(e);
    else groups.push({ key, first: e, items: [e] });
  }
  return groups;
}
