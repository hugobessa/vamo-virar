// App-wide state: every community this device belongs to, kept as Replicas,
// persisted through SealedStore and synced in the background while the app
// is open.

import { equalBytes, toHex } from "@vamo-virar/protocol";
import {
  NodeClient,
  NodeError,
  offerDeviceLink,
  parseDeviceLink,
  parseInvite,
  receiveDeviceLink,
  Replica,
  type LinkBundle,
  type LinkOffer,
  type SyncReport,
} from "@vamo-virar/sync";
import { SealedStore } from "./storage";
import { isNetworkError } from "../model/errors";
import { latestSeq, noticesFor, type Notice } from "../model/notifications";

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

/** A bundle received from another device, before it is applied. */
export interface IncomingLink {
  bundle: LinkBundle;
  /** Communities this device already has as a different member (joined here separately). */
  conflicts: { id: string; name: string }[];
}

/**
 * One device as the person sees it, across their communities. Each device
 * uses one name in all of them (the app keeps it unique when linking), so
 * the name is what ties the per-community entries together.
 */
export interface DeviceSummary {
  label: string;
  me: boolean;
  /** Main device in every community it is in. */
  main: boolean;
  communities: string[];
}

const SYNC_EVERY_MS = 20_000;
/** How often an admin or moderator device looks for orphaned attachments on the node (§9.7). */
const TIDY_BLOBS_EVERY_MS = 60 * 60_000;
/** System notifications shown for one sync; the rest wait in the list. */
const ANNOUNCE_MAX = 3;

/** The phone's notification system, as the app wires it (null on the web). */
export interface Notifier {
  /** This install's push token, or null when there is none to register. */
  pushToken(): Promise<string | null>;
  /** Shows notices that arrived with a sync, on the device, with content. */
  announce(entry: CommunityEntry, notices: Notice[]): Promise<void>;
}

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
  /** Set by the app: system notifications and the push token (§14). */
  notifier: Notifier | null = null;
  private pushToken: string | null = null;

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
    // Pin where notices stand before the sync, so only what it brings is announced.
    const notifiedBefore = e.replica.noticeMarks.notified;
    try {
      const report = await e.replica.sync();
      // Another of this person's devices unlinked this one (§10.5.6): forget it here.
      if (e.replica.unlinked) {
        await this.forget(id);
        return;
      }
      if (report.pulled > 0) await this.announce(e, notifiedBefore);
      await this.registerPush(e);
      // Work nobody asked for runs on one device only: the main one (§10.5.4).
      const main = e.replica.isMainDevice;
      // Moderators who left keep node access until an admin updates the set.
      if (main && e.replica.isAdmin) await e.replica.tidyModerators().catch(() => undefined);
      // Files whose task is gone stay on the node until someone with moderation drops them.
      if (main && e.replica.canModerate && Date.now() - (this.lastTidy.get(id) ?? 0) > TIDY_BLOBS_EVERY_MS) {
        this.lastTidy.set(id, Date.now());
        await e.replica.tidyBlobs().catch(() => undefined);
      }
      e.connectivity = "ok";
      e.lastSync = Date.now();
      e.lastReport = report;
      e.unseenRejections.push(...report.rejected.map((r) => ({ type: r.type, reason: r.reason })));
      if (main && this.autoAnswer && e.replica.incomingProbes.length) await this.autoAnswer(e).catch(() => undefined);
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

  /** Shows what a sync brought for this person, newest first, and remembers how far it got. */
  private async announce(e: CommunityEntry, notifiedBefore: number): Promise<void> {
    const state = e.replica.canonical;
    if (!state || e.replica.status !== "active") return;
    const fresh = noticesFor(state, state.members[e.replica.memberId]).filter((n) => n.seq > notifiedBefore);
    if (fresh.length === 0) return;
    e.replica.markNoticesNotified(latestSeq(fresh));
    if (this.notifier) await this.notifier.announce(e, fresh.slice(0, ANNOUNCE_MAX)).catch(() => undefined);
  }

  /** Gives the node this install's push token for an active community, once per token. */
  private async registerPush(e: CommunityEntry): Promise<void> {
    if (!this.pushToken || e.replica.status !== "active") return;
    // Idempotent in the replica, which also re-registers when this device becomes or stops being the main one.
    await e.replica.registerPush(this.pushToken).catch(() => undefined); // next sync tries again
  }

  /** Looks up the push token (asking the system, not the person) and registers it everywhere. */
  async refreshPush(): Promise<void> {
    if (!this.notifier) return;
    const token = await this.notifier.pushToken().catch(() => null);
    if (!token || token === this.pushToken) return;
    this.pushToken = token;
    for (const e of this.entries.values()) {
      await this.registerPush(e);
      if (e.replica.pushToken === token) void this.persist(e);
    }
  }

  /** This person looked at their notices in a community, up to `seq`. Only on this device. */
  markNoticesSeen(id: string, seq: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    const before = e.replica.noticeMarks.seen;
    e.replica.markNoticesSeen(seq);
    if (e.replica.noticeMarks.seen !== before) void this.persist(e);
  }

  clearRejections(id: string): void {
    const e = this.entries.get(id);
    if (e && e.unseenRejections.length) {
      e.unseenRejections = [];
      this.bump();
    }
  }

  /** Records that this person looked at a task up to `seq` (for the news badge). Only on this device. */
  markTaskSeen(id: string, taskId: string, seq: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    const before = e.replica.taskMarks.tasks[taskId];
    e.replica.markTaskSeen(taskId, seq);
    if (e.replica.taskMarks.tasks[taskId] !== before) void this.persist(e);
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

  // --- linked devices (protocol.md §10.5) ----------------------------------

  /** Memberships that can go to another device. */
  linkable(): CommunityEntry[] {
    return this.list().filter((e) => e.replica.status === "active" && !e.replica.disabled);
  }

  /** Source device: seals every active membership into a link for ten minutes. */
  async offerLink(label: string, base?: string): Promise<LinkOffer> {
    const entries = this.linkable();
    const offer = await offerDeviceLink(
      entries.map((e) => e.replica),
      label,
      base ? { base } : {},
    );
    // Linking made this device part of a device set; keep its new key.
    for (const e of entries) await this.persist(e);
    this.bump();
    return offer;
  }

  /** New device: fetches and opens the bundle. Nothing changes here until `applyLink`. */
  async receiveLink(link: string, code: string): Promise<IncomingLink> {
    const bundle = await receiveDeviceLink(parseDeviceLink(link), code);
    const conflicts = bundle.communities.flatMap((c) => {
      const e = this.entries.get(toHex(c.cid));
      if (!e || equalBytes(e.replica.keys.signing.sk, c.msk)) return [];
      return [{ id: e.id, name: e.replica.view?.community.name ?? e.id.slice(0, 8) }];
    });
    return { bundle, conflicts };
  }

  /**
   * Adds the memberships from a link. For a community this device already
   * has as another member, `replace` decides: the old membership leaves the
   * community first (§10.5.5), or the community is skipped.
   */
  async applyLink(incoming: IncomingLink, label: string, replace: ReadonlySet<string> = new Set()): Promise<string[]> {
    const name = uniqueLabel(label, incoming.bundle);
    const added: string[] = [];
    for (const c of incoming.bundle.communities) {
      const id = toHex(c.cid);
      const existing = this.entries.get(id);
      if (existing && equalBytes(existing.replica.keys.signing.sk, c.msk)) {
        existing.replica.absorbLink(c, name);
        await this.persist(existing);
        added.push(id);
        continue;
      }
      if (existing) {
        if (!replace.has(id)) continue;
        await this.leave(existing);
      }
      const e = this.track(Replica.fromLink(new NodeClient(c.node), c, name));
      await this.persist(e);
      added.push(id);
    }
    this.bump();
    await Promise.all(added.map((id) => this.syncOne(id)));
    if (this.timer) {
      this.stop();
      this.start();
    }
    return added;
  }

  /** Leaves a community for good and forgets it here; refuses if the leave did not reach the node. */
  private async leave(e: CommunityEntry): Promise<void> {
    if (e.replica.status === "active") {
      e.replica.submit("member.leave", {});
      await e.replica.sync();
      if (e.replica.pending.length) throw new Error("could not leave the old membership; check the connection and try again");
    }
    await this.forget(e.id);
  }

  /** This person's devices across their communities. Empty when this is the only one. */
  devices(): DeviceSummary[] {
    const byLabel = new Map<string, DeviceSummary>();
    for (const e of this.list()) {
      for (const d of e.replica.linkedDevices) {
        const s = byLabel.get(d.label) ?? { label: d.label, me: d.me, main: true, communities: [] };
        s.me ||= d.me;
        s.main &&= d.main;
        s.communities.push(e.id);
        byLabel.set(d.label, s);
      }
    }
    return [...byLabel.values()].sort((a, b) => Number(b.me) - Number(a.me) || a.label.localeCompare(b.label));
  }

  /** "Make this the main device", in every community this device is linked in. */
  async makeThisMain(): Promise<void> {
    for (const e of this.list()) {
      if (!e.replica.linkedDevices.some((d) => d.me) || e.replica.isMainDevice) continue;
      await e.replica.makeMainDevice();
      await this.persist(e);
    }
    this.bump();
  }

  /** Unlinks another device, by name, everywhere it is linked. */
  async unlinkDevice(label: string): Promise<void> {
    for (const e of this.list()) {
      const d = e.replica.linkedDevices.find((x) => x.label === label && !x.me);
      if (!d) continue;
      await e.replica.unlinkDevice(d.id);
      await this.persist(e);
    }
    this.bump();
  }

  /** Takes this device out of every device set and forgets those communities here. */
  async unlinkThisDevice(): Promise<void> {
    for (const e of this.list()) {
      const devices = e.replica.linkedDevices;
      const me = devices.find((x) => x.me);
      if (!me || devices.length < 2) continue; // the only device: nothing to leave
      await e.replica.unlinkDevice(me.id);
      await this.forget(e.id);
    }
  }

  async renameThisDevice(label: string): Promise<void> {
    const name = label.trim();
    if (this.devices().some((d) => !d.me && d.label === name)) throw new Error("another device already has this name");
    for (const e of this.list()) {
      if (!e.replica.linkedDevices.some((d) => d.me)) continue;
      await e.replica.renameDevice(label);
      await this.persist(e);
    }
    this.bump();
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
    void this.refreshPush().then(() => this.syncAll());
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

/** The new device's name, made unique among the devices already linked, so it can stand for the device everywhere. */
function uniqueLabel(label: string, bundle: LinkBundle): string {
  const taken = new Set(bundle.communities.flatMap((c) => c.devices?.devices.map((d) => d.label) ?? []));
  const base = label.trim().slice(0, 56) || "Dispositivo";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

function isOffline(err: unknown): boolean {
  return isNetworkError(err) || (err instanceof NodeError && err.status >= 502);
}
