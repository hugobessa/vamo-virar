// App-wide state: every community this device belongs to, kept as Replicas,
// persisted through SealedStore and synced in the background while the app
// is open.

import { toHex } from "@vamo-virar/protocol";
import { NodeClient, NodeError, parseInvite, Replica, type SyncReport } from "@vamo-virar/sync";
import { SealedStore } from "./storage";

export type Connectivity = "ok" | "offline";

export interface CommunityEntry {
  id: string; // community id, hex
  replica: Replica;
  connectivity: Connectivity;
  lastSync: number | null;
  lastReport: SyncReport | null;
  /** Rejections of this person's own changes not yet shown to them. */
  unseenRejections: { type: string; reason: string }[];
}

const SYNC_EVERY_MS = 20_000;
/** How often an admin or moderator device looks for orphaned attachments on the node (§9.7). */
const TIDY_BLOBS_EVERY_MS = 60 * 60_000;

export class AppStore {
  private readonly entries = new Map<string, CommunityEntry>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stops = new Map<string, () => void>();
  private lastTidy = new Map<string, number>();
  ready = false;
  /** Set by the app: answers pending probes when the person allowed it. */
  autoAnswer: ((e: CommunityEntry) => Promise<void>) | null = null;

  constructor(private readonly store: SealedStore = new SealedStore()) {}

  // --- subscription (for useSyncExternalStore) ---------------------------

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  // --- lifecycle -----------------------------------------------------------

  async init(): Promise<void> {
    for (const id of await this.store.list()) {
      const bytes = await this.store.read(id);
      if (!bytes) continue;
      try {
        const replica = Replica.load(new NodeClient(Replica.savedNode(bytes)), bytes);
        this.track(replica);
      } catch {
        // A blob we cannot read (corrupt or from a newer version): leave it on disk.
      }
    }
    this.ready = true;
    this.bump();
  }

  list(): CommunityEntry[] {
    return [...this.entries.values()].sort((a, b) =>
      (a.replica.view?.community.name ?? "").localeCompare(b.replica.view?.community.name ?? ""),
    );
  }

  get(id: string): CommunityEntry | undefined {
    return this.entries.get(id);
  }

  private track(replica: Replica): CommunityEntry {
    const id = toHex(replica.cid);
    const entry: CommunityEntry = { id, replica, connectivity: "ok", lastSync: null, lastReport: null, unseenRejections: [] };
    this.entries.set(id, entry);
    replica.onChange(() => this.bump());
    return entry;
  }

  private async persist(e: CommunityEntry): Promise<void> {
    await this.store.write(e.id, e.replica.save());
  }

  // --- actions -------------------------------------------------------------

  async create(input: { node: string; setupCode?: string; name: string; description?: string; whatsapp?: string; displayName: string }): Promise<string> {
    const client = new NodeClient(input.node, input.setupCode ? { provisioningToken: input.setupCode } : {});
    const replica = await Replica.found(client, {
      name: input.name,
      description: input.description ?? "",
      whatsapp: input.whatsapp,
      displayName: input.displayName,
    });
    const e = this.track(replica);
    await this.persist(e);
    this.bump();
    return e.id;
  }

  async join(link: string, input: { displayName: string; contact?: string; message?: string }): Promise<string> {
    const invite = parseInvite(link.trim());
    const existing = this.entries.get(toHex(invite.cid));
    if (existing) return existing.id;
    const replica = await Replica.join(new NodeClient(invite.node), invite, input);
    const e = this.track(replica);
    await this.persist(e);
    this.bump();
    return e.id;
  }

  /** Queues a change and syncs soon. The change is visible immediately. */
  submit(id: string, type: string, body: Parameters<Replica["submit"]>[1]): void {
    const e = this.entries.get(id);
    if (!e || e.replica.disabled) return; // marked for deletion: nothing changes
    e.replica.submit(type, body);
    void this.persist(e);
    void this.syncOne(id);
  }

  async syncOne(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e) return;
    try {
      const report = await e.replica.sync();
      // Moderators who left keep node access until an admin updates the set.
      if (e.replica.isAdmin) await e.replica.tidyModerators().catch(() => undefined);
      // Files whose task is gone stay on the node until someone with moderation drops them.
      if (e.replica.canModerate && Date.now() - (this.lastTidy.get(id) ?? 0) > TIDY_BLOBS_EVERY_MS) {
        this.lastTidy.set(id, Date.now());
        await e.replica.tidyBlobs().catch(() => undefined);
      }
      e.connectivity = "ok";
      e.lastSync = Date.now();
      e.lastReport = report;
      e.unseenRejections.push(...report.rejected.map((r) => ({ type: r.type, reason: r.reason })));
      if (this.autoAnswer && e.replica.incomingProbes.length) await this.autoAnswer(e).catch(() => undefined);
      await this.persist(e);
    } catch (err) {
      // Marked for deletion and past the date: the server deleted it, so this phone forgets it too.
      const d = e.replica.disabled;
      if (d && Date.now() >= d.deleteAt && err instanceof NodeError && err.code === "not_hosted") {
        await this.forget(id);
        return;
      }
      e.connectivity = isOffline(err) ? "offline" : e.connectivity;
      if (!isOffline(err)) console.warn("sync failed", err);
    }
    this.bump();
  }

  async syncAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.syncOne(id)));
  }

  clearRejections(id: string): void {
    const e = this.entries.get(id);
    if (e && e.unseenRejections.length) {
      e.unseenRejections = [];
      this.bump();
    }
  }

  /** Runs an admin action, then persists. Errors propagate to the screen. */
  async admin<T>(id: string, f: (r: Replica) => Promise<T>): Promise<T> {
    const e = this.entries.get(id);
    if (!e) throw new Error("unknown community");
    const out = await f(e.replica);
    await this.persist(e);
    this.bump();
    return out;
  }

  async forget(id: string): Promise<void> {
    this.stops.get(id)?.();
    this.stops.delete(id);
    this.entries.delete(id);
    await this.store.remove(id);
    this.bump();
  }

  // --- background sync while the app is in the foreground -----------------

  start(): void {
    if (this.timer) return;
    void this.syncAll();
    this.timer = setInterval(() => void this.syncAll(), SYNC_EVERY_MS);
    for (const [id, e] of this.entries) {
      if (e.replica.status !== "active" || this.stops.has(id)) continue;
      e.replica
        .watch()
        .then((stop) => this.stops.set(id, stop))
        .catch(() => undefined); // live updates are a bonus; polling covers it
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const s of this.stops.values()) s();
    this.stops.clear();
  }
}

function isOffline(err: unknown): boolean {
  if (err instanceof NodeError) return err.status === 0 || err.status >= 502;
  return err instanceof TypeError; // fetch network failure
}
