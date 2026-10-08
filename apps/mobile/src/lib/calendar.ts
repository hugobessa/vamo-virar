// Calendar sources on this device (architecture.md §18–§19).
//
// What is stored: busy intervals (start, end, busy/tentative, all-day) for
// the next 90 days, sealed like everything else, and OAuth tokens in the
// platform keystore. What is never stored or sent: titles, places, guests,
// notes. Nothing here is shared with the community.

import {
  BusyCache,
  CalendarError,
  DEFAULT_PREFS,
  fetchGoogleBusy,
  fetchMicrosoftBusy,
  GOOGLE,
  MICROSOFT,
  parseDeviceEvents,
  type Availability,
  type AvailabilityPrefs,
  type CacheData,
} from "@vamo-virar/matching";
import { decode, encode, type CborValue } from "@vamo-virar/protocol";
import { Platform } from "react-native";
import { SealedStore } from "./storage";

export type SourceId = "device" | "google" | "microsoft";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  clientId: string;
}

interface Persisted {
  cache: CacheData;
  prefs: AvailabilityPrefs;
  deviceCalendars: string[];
  needsReauth: SourceId[];
}

const DAY = 86_400_000;
const WINDOW_BEFORE = DAY;
const WINDOW_AFTER = 90 * DAY;
const REFRESH_EVERY = 15 * 60_000;
const BLOB = "calendar";

export const deviceCalendarsSupported = Platform.OS !== "web";

async function secure() {
  return import("expo-secure-store");
}

async function loadTokens(source: "google" | "microsoft"): Promise<OAuthTokens | null> {
  if (Platform.OS === "web") return null;
  const raw = await (await secure()).getItemAsync(`vv.oauth.${source}`);
  return raw ? (JSON.parse(raw) as OAuthTokens) : null;
}

async function saveTokens(source: "google" | "microsoft", t: OAuthTokens | null): Promise<void> {
  if (Platform.OS === "web") return;
  const s = await secure();
  if (t) await s.setItemAsync(`vv.oauth.${source}`, JSON.stringify(t), { keychainAccessible: s.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  else await s.deleteItemAsync(`vv.oauth.${source}`);
}

export class CalendarService {
  private cache = new BusyCache();
  private data: Persisted = { cache: {}, prefs: DEFAULT_PREFS, deviceCalendars: [], needsReauth: [] };
  private readonly listeners = new Set<() => void>();
  private loaded: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  version = 0;

  constructor(private readonly store: SealedStore = new SealedStore()) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = () => this.version;

  private changed(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        const raw = await this.store.read(BLOB);
        if (raw) {
          try {
            this.data = { ...this.data, ...(decode(raw) as unknown as Persisted) };
          } catch {
            // unreadable: start fresh
          }
        }
        this.cache = new BusyCache(this.data.cache);
        this.changed();
      })();
    }
    return this.loaded;
  }

  private async save(): Promise<void> {
    this.data.cache = this.cache.toJSON();
    await this.store.write(BLOB, encode(this.data as unknown as CborValue));
    this.changed();
  }

  // --- read side ------------------------------------------------------------

  connected(): SourceId[] {
    return this.cache.sources() as SourceId[];
  }

  needsReauth(source: SourceId): boolean {
    return this.data.needsReauth.includes(source);
  }

  prefs(): AvailabilityPrefs {
    return this.data.prefs;
  }

  /** null when no connected calendar covers that time. */
  check(window: { start: number; end: number }): Availability | null {
    return this.cache.check(window, this.data.prefs);
  }

  // --- connect / disconnect -------------------------------------------------

  async connectDevice(): Promise<boolean> {
    if (!deviceCalendarsSupported) return false;
    const Calendar = await import("expo-calendar");
    const perm = await Calendar.requestCalendarPermissions();
    if (!perm.granted) return false;
    const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    this.data.deviceCalendars = cals.map((c) => c.id);
    await this.refreshSource("device");
    return true;
  }

  /** Called by the settings screen after a successful OAuth code exchange. */
  async connectOAuth(source: "google" | "microsoft", tokens: OAuthTokens): Promise<void> {
    await saveTokens(source, tokens);
    this.data.needsReauth = this.data.needsReauth.filter((s) => s !== source);
    await this.refreshSource(source);
  }

  async disconnect(source: SourceId): Promise<void> {
    if (source === "google") {
      const t = await loadTokens("google");
      if (t) {
        // Best effort: tell Google to forget the grant too.
        await fetch(`${GOOGLE.discovery.revocationEndpoint}?token=${encodeURIComponent(t.refreshToken ?? t.accessToken)}`, { method: "POST" }).catch(() => undefined);
      }
    }
    if (source !== "device") await saveTokens(source, null);
    if (source === "device") this.data.deviceCalendars = [];
    this.cache.remove(source);
    this.data.needsReauth = this.data.needsReauth.filter((s) => s !== source);
    await this.save();
  }

  async setPrefs(p: Partial<AvailabilityPrefs>): Promise<void> {
    this.data.prefs = { ...this.data.prefs, ...p };
    await this.save();
  }

  // --- refresh --------------------------------------------------------------

  /** Refreshes every connected source whose data is older than 15 minutes. */
  refreshStale(force = false): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        await this.load();
        for (const s of this.connected()) {
          const snap = this.cache.snapshot(s);
          if (force || !snap || Date.now() - snap.fetchedAt > REFRESH_EVERY) {
            await this.refreshSource(s).catch(() => undefined);
          }
        }
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refreshSource(source: SourceId): Promise<void> {
    const now = Date.now();
    const from = now - WINDOW_BEFORE;
    const to = now + WINDOW_AFTER;
    try {
      let intervals;
      if (source === "device") {
        const Calendar = await import("expo-calendar");
        const events = await Calendar.listEvents(this.data.deviceCalendars, new Date(from), new Date(to));
        intervals = parseDeviceEvents(events);
      } else {
        const token = await this.accessToken(source);
        if (!token) return;
        intervals =
          source === "google"
            ? await fetchGoogleBusy(token, from, to, (u, i) => fetch(u, i))
            : await fetchMicrosoftBusy(token, from, to, (u, i) => fetch(u, i));
      }
      this.cache.set(source, { fetchedAt: now, from, to, intervals });
    } catch (e) {
      if (e instanceof CalendarError && e.needsReauth) {
        this.markReauth(source);
      } else {
        throw e;
      }
    } finally {
      await this.save();
    }
  }

  private async accessToken(source: "google" | "microsoft"): Promise<string | null> {
    const t = await loadTokens(source);
    if (!t) return null;
    if (t.expiresAt > Date.now() + 60_000) return t.accessToken;
    if (!t.refreshToken) {
      this.markReauth(source);
      return null;
    }
    const AuthSession = await import("expo-auth-session");
    const discovery = source === "google" ? GOOGLE.discovery : MICROSOFT.discovery;
    try {
      const r = await AuthSession.refreshAsync({ clientId: t.clientId, refreshToken: t.refreshToken }, discovery);
      const next: OAuthTokens = {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken ?? t.refreshToken,
        expiresAt: Date.now() + (r.expiresIn ?? 3600) * 1000,
        clientId: t.clientId,
      };
      await saveTokens(source, next);
      return next.accessToken;
    } catch {
      this.markReauth(source);
      return null;
    }
  }

  private markReauth(source: SourceId): void {
    if (!this.data.needsReauth.includes(source)) this.data.needsReauth.push(source);
  }
}
