import { DEFAULT_POLICY } from "../src/policy.js";
import type { CommunityState, ControlHeader, Entry, Policy } from "../src/types.js";
import { canonicalJson, memberIdOf } from "../src/util.js";

export const T0 = Date.UTC(2026, 9, 1);
export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** Deterministic 32-byte hex key for test identity `n`. */
export function key(n: number): string {
  return n.toString(16).padStart(8, "0").repeat(8);
}

export function eventId(n: number): string {
  return n.toString(16).padStart(8, "0").repeat(4);
}

/** Distinct from event ids (which repeat the counter) so a mix-up fails loudly. */
export function taskId(n: number): string {
  return `7a5${n.toString(16).padStart(5, "0")}`.repeat(4);
}

export function commentId(n: number): string {
  return `c0${n.toString(16).padStart(6, "0")}`.repeat(4);
}

/** A well-formed attachment record for test task `n`. */
export function attachment(n: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    blob_id: key(900 + n),
    key: key(950 + n),
    nonce: n.toString(16).padStart(8, "0").repeat(6),
    name: `foto-${n}.jpg`,
    mime: "image/jpeg",
    size: 1234,
    ...extra,
  };
}

export interface Person {
  name: string;
  msk: string;
  mek: string;
  id: string;
}

let personCounter = 1000;
export function person(name: string): Person {
  const n = personCounter++;
  const msk = key(n);
  return { name, msk, mek: key(n + 500_000), id: memberIdOf(msk) };
}

export const CRK = key(1);

export interface OpOpts {
  at?: number;
  epoch?: number;
  opId?: string;
}

/** Builds a log with contiguous seqs and node times that advance 1 minute per entry. */
export class LogBuilder {
  readonly entries: Entry[] = [];
  epoch = 0;
  at = T0;
  private opCounter = 0;

  constructor(
    readonly founders: Person[],
    policy: Policy = DEFAULT_POLICY,
  ) {
    this.push({
      control: {
        kind: "genesis",
        signer: CRK,
        args: { suite: "VV1", crk: CRK, admins: founders.map((f) => f.msk), eak: key(2), ik: key(3) },
      },
      op: {
        author: founders[0]!.msk,
        base: 0,
        ts: 0,
        type: "community.init",
        body: {
          name: "Coletivo Recife",
          description: "",
          policy,
          founders: founders.map((f) => ({ msk: f.msk, mek: f.mek, profile: { display_name: f.name } })),
        },
      },
    });
  }

  nextOpId(): string {
    return (++this.opCounter).toString(16).padStart(32, "0");
  }

  private push(
    e: { control?: ControlHeader; op: Entry["op"] },
    opts: OpOpts = {},
  ): Entry {
    if (opts.at !== undefined) this.at = opts.at;
    else if (this.entries.length > 0) this.at += 60_000;
    const entry: Entry = {
      seq: this.entries.length + 1,
      opId: opts.opId ?? this.nextOpId(),
      epoch: opts.epoch ?? this.epoch,
      at: this.at,
      op: e.op,
    };
    if (e.control) entry.control = e.control;
    this.entries.push(entry);
    return entry;
  }

  op(author: Person | string, type: string, body: unknown, opts?: OpOpts): Entry {
    const msk = typeof author === "string" ? author : author.msk;
    return this.push({ op: { author: msk, base: this.entries.length, ts: 0, type, body } }, opts);
  }

  opaque(opts?: OpOpts): Entry {
    return this.push({ op: null }, opts);
  }

  rotate(signer: Person | string, opts?: OpOpts & { newEpoch?: number }): Entry {
    const msk = typeof signer === "string" ? signer : signer.msk;
    const newEpoch = opts?.newEpoch ?? this.epoch + 1;
    const e = this.push(
      {
        control: { kind: "rotate", signer: msk, args: { new_epoch: newEpoch, eak: key(10 + newEpoch) } },
        op: { author: msk, base: 0, ts: 0, type: "epoch.rotate", body: { reason: "test", removed: [] } },
      },
      opts,
    );
    this.epoch = Math.max(this.epoch, newEpoch);
    return e;
  }

  adminSet(signer: Person | string, admins: Person[], opts?: OpOpts): Entry {
    const msk = typeof signer === "string" ? signer : signer.msk;
    return this.push(
      {
        control: { kind: "admin.set", signer: msk, args: { admins: admins.map((a) => a.msk) } },
        op: { author: msk, base: 0, ts: 0, type: "admin.set", body: {} },
      },
      opts,
    );
  }

  modSet(signer: Person | string, moderators: Person[], opts?: OpOpts): Entry {
    const msk = typeof signer === "string" ? signer : signer.msk;
    return this.push(
      {
        control: { kind: "mod.set", signer: msk, args: { moderators: moderators.map((m) => m.msk) } },
        op: { author: msk, base: 0, ts: 0, type: "mod.set", body: {} },
      },
      opts,
    );
  }

  /** `disable` or `enable` (§11.5). */
  toggle(kind: "disable" | "enable", signer: Person | string, opts?: OpOpts): Entry {
    const msk = typeof signer === "string" ? signer : signer.msk;
    return this.push(
      {
        control: { kind, signer: msk, args: {} },
        op: { author: msk, base: 0, ts: 0, type: `community.${kind}`, body: {} },
      },
      opts,
    );
  }

  migrate(signer: Person | string, nodes: string[], opts?: OpOpts): Entry {
    const msk = typeof signer === "string" ? signer : signer.msk;
    return this.push(
      {
        control: { kind: "migrate", signer: msk, args: { nodes } },
        op: { author: msk, base: 0, ts: 0, type: "community.migrate", body: {} },
      },
      opts,
    );
  }

  // Convenience domain ops ------------------------------------------------

  add(admin: Person, p: Person, role: "member" | "organizer" = "member"): Entry {
    return this.op(admin, "member.add", { msk: p.msk, mek: p.mek, profile: { display_name: p.name }, role });
  }

  createEvent(org: Person, n: number, extra: Record<string, unknown> = {}): string {
    const id = eventId(n);
    this.op(org, "event.create", {
      event_id: id,
      title: `Ato ${n}`,
      starts_at: T0 + 10 * DAY,
      ends_at: T0 + 10 * DAY + 3 * HOUR,
      tz: "America/Recife",
      location: { label: "Praça do Derby", area: { lat_e4: -80_571, lng_e4: -348_950 } },
      ...extra,
    });
    return id;
  }

  createTask(author: Person, n: number, extra: Record<string, unknown> = {}): string {
    const id = taskId(n);
    this.op(author, "task.create", { task_id: id, title: `Tarefa ${n}`, ...extra });
    return id;
  }

  part(actor: Person, action: string, ev: string, target?: Person): Entry {
    const body: Record<string, unknown> = { event_id: ev };
    if (target) body.member_id = target.id;
    return this.op(actor, `participation.${action}`, body);
  }
}

/** Canonical form for equality, ignoring device-local bookkeeping. */
export function canon(s: CommunityState, ignore: (keyof CommunityState)[] = ["op_ids"]): string {
  const copy: Record<string, unknown> = { ...s };
  for (const k of ignore) delete copy[k];
  return canonicalJson(copy);
}
