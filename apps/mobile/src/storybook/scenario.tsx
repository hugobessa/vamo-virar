// Mock data and context for the screen stories. Everything here is synthetic.
//
// Storybook swaps `lib/context`, `lib/storage`, `lib/matching`, `lib/confirm`
// and `expo-router` for the stand-ins in this folder (see .storybook/main.ts),
// so the real screens in src/app render without a node, keys or a calendar.

import type { CommunityState, Event, MemberRecord, Participation, ParticipationStatus, Role } from "@vamo-virar/domain";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { action } from "storybook/actions";
import { translator } from "../model/i18n";

/** Fixed "now" so stories look the same every day: Saturday 10 Oct 2026, 15:00 in Recife. */
export const NOW = new Date("2026-10-10T15:00:00-03:00").getTime();
const H = 3_600_000;
const D = 24 * H;
const RECIFE = { lat_e4: -80_500, lng_e4: -348_800 };

// --- state ----------------------------------------------------------------

function member(key: string, name: string, role: Role, status: MemberRecord["status"] = "active"): MemberRecord {
  return { member_id: key, msk: `msk-${key}`, mek: `mek-${key}`, role, status, profile: { display_name: name }, joined_seq: 1, key_epoch: 1 };
}

const part = (status: ParticipationStatus): Participation => ({ status, updated_seq: 5 });

function event(o: Pick<Event, "event_id" | "title" | "starts_at"> & Partial<Event>): Event {
  return {
    description: "",
    ends_at: o.starts_at + 3 * H,
    tz: "America/Recife",
    location: { label: "Praça da Vila", area: RECIFE },
    organizers: ["ana"],
    status: "scheduled",
    created_seq: 3,
    participations: {},
    ...o,
  };
}

export type Me = "ana" | "bia" | "caio" | "duda" | "edu";

/** A community with one admin (Ana), one organizer (Bia) and three members. */
export function communityState(): CommunityState {
  const members = [
    member("ana", "Ana Souza", "admin"),
    member("bia", "Bia Lima", "organizer"),
    member("caio", "Caio Alves", "member"),
    member("duda", "Duda Reis", "member"),
    member("edu", "Edu Nunes", "member"),
  ];
  const events = [
    event({
      event_id: "e1",
      title: "Mutirão da horta",
      description: "Vamos capinar os canteiros e plantar as mudas novas. Traga luvas e uma garrafa d'água.",
      starts_at: NOW + D - 5 * H,
      capacity: 12,
      whatsapp: "https://chat.whatsapp.com/HortaDaVila",
      participations: { ana: part("confirmed"), bia: part("confirmed"), caio: part("volunteered"), duda: part("invited"), edu: part("declined") },
    }),
    event({
      event_id: "e2",
      title: "Assembleia do bairro",
      starts_at: NOW + 4 * D + 4 * H,
      location: { label: "Salão paroquial", area: RECIFE },
      capacity: 30,
      organizers: ["bia"],
      participations: { bia: part("confirmed"), caio: part("invited") },
    }),
    event({
      event_id: "e3",
      title: "Feira de trocas",
      starts_at: NOW + 7 * D - 6 * H,
      location: { label: "Escola municipal", area: RECIFE },
      capacity: 2,
      participations: { ana: part("confirmed"), bia: part("confirmed") },
    }),
    event({
      event_id: "e4",
      title: "Cine na praça",
      starts_at: NOW - 3 * D,
      status: "cancelled",
      participations: { ana: part("confirmed") },
    }),
    event({
      event_id: "e5",
      title: "Plantio de mudas",
      starts_at: NOW - 10 * D,
      status: "completed",
      participations: { ana: part("confirmed"), bia: part("confirmed"), caio: part("confirmed") },
      attended: ["ana", "bia"],
    }),
  ];
  return {
    community: {
      crk: "crk",
      name: "Horta da Vila",
      description: "Cuidamos juntas da horta comunitária e dos encontros do bairro.",
      whatsapp: "https://chat.whatsapp.com/HortaDaVila",
      policy: {
        join: "request",
        rotate_on_join: false,
        volunteer_mode: "confirm",
        participation_visible: "community",
        retention: { completed_event_detail_days: 90, keep_attendee_list: true, removed_member_detail_days: 30, rejected_join_request_days: 30 },
      },
    },
    epoch: 1,
    eak: "eak",
    admin_set: ["msk-ana"],
    ik: "ik",
    clock: { seq: 20, now: NOW },
    members: Object.fromEntries(members.map((m) => [m.member_id, m])),
    events: Object.fromEntries(events.map((e) => [e.event_id, e])),
    event_summaries: {
      old1: { event_id: "old1", title: "Primeira reunião", starts_at: NOW - 200 * D, status: "completed", confirmed_count: 9, attended_count: 7 },
    },
    rejected_recent: [],
    op_ids: {},
  };
}

// --- entries (what `store.list()` returns) -----------------------------------

export interface EntryOptions {
  id?: string;
  me?: Me;
  /** Replica status: "active", "joining" (waiting for approval), "rejected". */
  status?: string;
  connectivity?: "ok" | "offline";
  /** Changes made on this phone that the server has not seen yet. */
  pending?: number;
  rejections?: { type: string; reason: string }[];
  /** The organizers asked this person whether they can come to e1. */
  incomingProbe?: boolean;
  /** Admin view: people waiting to be accepted. */
  joinRequests?: boolean;
  /** Organizer view: answers to "who can come?" on e1. */
  probeReplies?: boolean;
  /** Admin view: reports about members, and someone already blocked. */
  reports?: boolean;
  /** Duda is a moderator. */
  moderator?: boolean;
  /** Bia is an admin too (Coordenação), not only an organizer. */
  secondAdmin?: boolean;
  /** An admin marked the community for deletion three days ago. */
  disabledBy?: Me;
  state?: CommunityState;
}

export function makeEntry(o: EntryOptions = {}) {
  const state = o.state ?? communityState();
  if (o.moderator) state.mod_set = ["msk-duda"];
  if (o.secondAdmin) state.admin_set = ["msk-ana", "msk-bia"];
  if (o.disabledBy) state.community.disabled = { by: `msk-${o.disabledBy}`, at: NOW - 3 * D };
  const disabled = state.community.disabled;
  if (o.reports) state.members.gil = { ...member("gil", "Gil Prado", "member", "removed"), blocked: true };
  const me = o.me ?? "ana";
  const active = (o.status ?? "active") === "active";
  const requests = o.joinRequests
    ? [
        { intakeId: "r1", request: { profile: { display_name: "Fabi Costa" }, message: "Moro na rua de trás e quero ajudar na horta." } },
        { intakeId: "r2", request: { profile: { display_name: "Gil Prado" } } },
      ]
    : [];
  const replica = {
    view: active ? state : null,
    canonical: state,
    status: o.status ?? "active",
    memberId: me,
    isAdmin: me === "ana" || (!!o.secondAdmin && me === "bia"),
    disabled: disabled ? { ...disabled, deleteAt: disabled.at + 30 * D } : undefined,
    disableCommunity: async () => action("replica.disableCommunity")(),
    enableCommunity: async () => action("replica.enableCommunity")(),
    isModerator: !!o.moderator && me === "duda",
    canModerate: me === "ana" || (!!o.moderator && me === "duda"),
    node: "https://horta.example.org",
    recoveryKey: me === "ana" ? new Uint8Array(32).map((_, i) => (i * 37 + 11) % 256) : null,
    pending: new Array(o.pending ?? 0).fill({}),
    incomingProbes: o.incomingProbe ? [{ probeId: "p1", eventId: "e1" }] : [],
    probeResults: (eventId: string) =>
      o.probeReplies && eventId === "e1" ? { asked: 4, replies: { bia: "eligible", caio: "maybe", duda: "not_eligible" } } : undefined,
    joinRequests: async () => requests,
    reports: o.reports
      ? [
          { reportId: "rp1", reporter: "duda", memberId: "edu", reason: "harassment", details: "Mandou mensagens ofensivas para várias pessoas depois da assembleia.", receivedAt: NOW - 3 * H },
          { reportId: "rp2", reporter: "bia", memberId: "edu", reason: "spam", receivedAt: NOW - D },
        ]
      : [],
    reportMember: async (...a: unknown[]) => action("replica.reportMember")(...a),
    dismissReport: action("replica.dismissReport"),
    blockMember: async (id: string) => action("replica.blockMember")(id),
    makeModerator: async (id: string) => action("replica.makeModerator")(id),
    removeModerator: async (id: string) => action("replica.removeModerator")(id),
    unblockMember: async (id: string) => action("replica.unblockMember")(id),
    approve: async (p: unknown) => action("replica.approve")(p),
    reject: async (p: unknown) => action("replica.reject")(p),
    createInvite: async (opts: unknown) => {
      action("replica.createInvite")(opts);
      return "vamovirar://join?c=0a1b2c3d&n=https%3A%2F%2Fhorta.example.org&k=9f8e7d6c&i=5b4a";
    },
    makeAdmin: async (id: string) => action("replica.makeAdmin")(id),
    removeMember: async (id: string) => action("replica.removeMember")(id),
    answerProbe: async (id: string, a: string) => action("replica.answerProbe")(id, a),
    dropProbe: action("replica.dropProbe"),
    askWhoCanCome: async (id: string) => action("replica.askWhoCanCome")(id),
    rotateIntakeKey: async () => action("replica.rotateIntakeKey")(),
    recoverAdmins: async (...a: unknown[]) => action("replica.recoverAdmins")(...a),
    migrateTo: async (t: unknown) => action("replica.migrateTo")(t),
  };
  return {
    id: o.id ?? "c1",
    replica,
    connectivity: o.connectivity ?? "ok",
    lastSync: NOW - 2 * 60_000,
    lastReport: null,
    unseenRejections: o.rejections ?? [],
  };
}
export type MockEntry = ReturnType<typeof makeEntry>;

// --- calendar service (Settings) -----------------------------------------------

export function makeCalendar(initial: { connected?: string[]; places?: { id: string; label: string; radiusKm: number; activeFrom?: number; activeTo?: number }[] } = {}) {
  const connected = new Set(initial.connected ?? []);
  let places = initial.places ?? [];
  let prefs = { bufferMinutes: 30, allDayBlocks: true };
  let locationPrefs = { travelKmh: 40 };
  let auto = false;
  let version = 0;
  const listeners = new Set<() => void>();
  const bump = () => {
    version++;
    listeners.forEach((l) => l());
  };
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getVersion: () => version,
    load: async () => {},
    connected: () => [...connected],
    needsReauth: () => false,
    connectDevice: async () => {
      connected.add("device");
      bump();
      return true;
    },
    connectOAuth: async (source: string) => {
      connected.add(source);
      bump();
    },
    disconnect: async (source: string) => {
      connected.delete(source);
      bump();
    },
    prefs: () => prefs,
    setPrefs: async (p: Partial<typeof prefs>) => {
      prefs = { ...prefs, ...p };
      bump();
    },
    places: () => places,
    addPlace: async (p: { label: string; radiusKm: number }) => {
      places = [...places, { id: `p${places.length + 1}`, ...p }];
      bump();
    },
    removePlace: async (id: string) => {
      places = places.filter((p) => p.id !== id);
      bump();
    },
    addCurrentLocation: async (label: string, radiusKm: number) => {
      places = [...places, { id: `p${places.length + 1}`, label, radiusKm }];
      bump();
      return true;
    },
    locationPrefs: () => locationPrefs,
    setTravelSpeed: async (n: number) => {
      locationPrefs = { travelKmh: n };
      bump();
    },
    autoAnswer: () => auto,
    setAutoAnswer: async (v: boolean) => {
      auto = v;
      bump();
    },
  };
}
export type MockCalendar = ReturnType<typeof makeCalendar>;

/** Calendar and location fit shown on event cards; varies a little by event. */
export function eligibilityFor(ev: { starts_at: number }) {
  const n = Math.floor(ev.starts_at / D) % 3;
  const verdict = (["available", "maybe", "busy"] as const)[n]!;
  const loc = (["near", "edge", "far"] as const)[(n + 1) % 3]!;
  return {
    known: true,
    verdict: verdict === "available" ? "eligible" : verdict === "maybe" ? "maybe" : "not_eligible",
    calendar: { verdict },
    location: { verdict: loc, point: { label: "Casa" }, distanceKm: loc === "near" ? 2.4 : loc === "edge" ? 14 : 38 },
  };
}

// --- context -------------------------------------------------------------------

export interface Scenario {
  entries: MockEntry[];
  /** Route params, as `useLocalSearchParams` returns them. */
  params: Record<string, string>;
  calendar: MockCalendar;
}

export const ScenarioContext = createContext<Scenario | null>(null);

export function useScenario(): Scenario {
  const s = useContext(ScenarioContext);
  if (!s) throw new Error("Story is missing a <Phone scenario=…> wrapper");
  return s;
}

export function buildStore(s: Scenario) {
  return {
    ready: true,
    subscribe: () => () => {},
    getVersion: () => 0,
    list: () => s.entries,
    get: (id: string) => s.entries.find((e) => e.id === id),
    submit: action("store.submit"),
    syncOne: async () => {},
    clearRejections: action("store.clearRejections"),
    admin: async (id: string, f: (r: MockEntry["replica"]) => Promise<unknown>) => f((s.entries.find((e) => e.id === id) ?? s.entries[0]!).replica),
    create: async (input: unknown) => {
      action("store.create")(input);
      return s.entries[0]?.id ?? "novo";
    },
    join: async (link: string, input: unknown) => {
      action("store.join")(link, input);
      return s.entries[0]?.id ?? "novo";
    },
  };
}

export function ScenarioProvider({ scenario, children }: { scenario: Partial<Scenario>; children: ReactNode }) {
  const value = useMemo<Scenario>(() => ({ entries: [], params: {}, calendar: makeCalendar(), ...scenario }), [scenario]);
  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export const t = translator();
