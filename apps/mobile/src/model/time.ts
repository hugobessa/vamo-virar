// Date and time entry that works the same on every platform: plain text
// fields in the person's local time, validated here.

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDateInput(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
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
