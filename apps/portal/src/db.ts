// Access requests, in one SQLite file next to (not inside) the node's data.
//
// Status flow:
//   unverified --email confirmed--> pending --approved--> approved
//   pending --rejected--> rejected
//   approved --revoked--> revoked --new code--> approved
// "approving" is held while the node and the mail server are being called,
// so a double click cannot hand out two codes.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Status = "unverified" | "pending" | "approving" | "approved" | "rejected" | "revoked";

export interface AccessRequest {
  id: number;
  createdAt: number;
  name: string;
  email: string;
  community: string;
  about: string;
  city: string;
  status: Status;
  verifyExpires: number;
  verifiedAt: number | null;
  decidedAt: number | null;
  tenant: string | null;
  maxCommunities: number | null;
  maxLogBytes: number | null;
  maxBlobBytes: number | null;
  reason: string | null;
}

export interface NewRequest {
  name: string;
  email: string;
  community: string;
  about: string;
  city: string;
  verifyHash: string;
  verifyExpires: number;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      INTEGER NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  community       TEXT NOT NULL,
  about           TEXT NOT NULL,
  city            TEXT NOT NULL,
  status          TEXT NOT NULL,
  verify_hash     TEXT,
  verify_expires  INTEGER NOT NULL,
  verified_at     INTEGER,
  decided_at      INTEGER,
  tenant          TEXT,
  max_communities INTEGER,
  max_log_bytes   INTEGER,
  max_blob_bytes  INTEGER,
  reason          TEXT
);
CREATE INDEX IF NOT EXISTS requests_by_email ON requests (email, created_at);
CREATE INDEX IF NOT EXISTS requests_by_status ON requests (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS requests_by_verify ON requests (verify_hash);
`;

type Row = Record<string, string | number | null>;

function toRequest(r: Row): AccessRequest {
  const num = (k: string) => (r[k] === null ? null : Number(r[k]));
  return {
    id: Number(r.id),
    createdAt: Number(r.created_at),
    name: String(r.name),
    email: String(r.email),
    community: String(r.community),
    about: String(r.about),
    city: String(r.city),
    status: String(r.status) as Status,
    verifyExpires: Number(r.verify_expires),
    verifiedAt: num("verified_at"),
    decidedAt: num("decided_at"),
    tenant: r.tenant === null ? null : String(r.tenant),
    maxCommunities: num("max_communities"),
    maxLogBytes: num("max_log_bytes"),
    maxBlobBytes: num("max_blob_bytes"),
    reason: r.reason === null ? null : String(r.reason),
  };
}

export class Requests {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  static open(dataDir: string): Requests {
    mkdirSync(dataDir, { recursive: true });
    return new Requests(join(dataDir, "portal.sqlite"));
  }

  close() {
    this.db.close();
  }

  create(r: NewRequest, now: number): number {
    const res = this.db
      .prepare(
        `INSERT INTO requests (created_at, name, email, community, about, city, status, verify_hash, verify_expires)
         VALUES (?, ?, ?, ?, ?, ?, 'unverified', ?, ?)`,
      )
      .run(now, r.name, r.email, r.community, r.about, r.city, r.verifyHash, r.verifyExpires);
    return Number(res.lastInsertRowid);
  }

  get(id: number): AccessRequest | undefined {
    const r = this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as Row | undefined;
    return r && toRequest(r);
  }

  /** Requests from this address still waiting on someone (them or the admin). */
  openFor(email: string): AccessRequest[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM requests WHERE email = ? AND status IN ('unverified', 'pending', 'approving') ORDER BY id",
      )
      .all(email) as Row[];
    return rows.map(toRequest);
  }

  /** Confirms the request behind a verification link. The link works once. */
  verify(verifyHash: string, now: number): AccessRequest | "expired" | undefined {
    const r = this.db.prepare("SELECT * FROM requests WHERE verify_hash = ?").get(verifyHash) as Row | undefined;
    if (!r) return undefined;
    const req = toRequest(r);
    if (req.verifyExpires < now) return "expired";
    const res = this.db
      .prepare("UPDATE requests SET status = 'pending', verified_at = ?, verify_hash = NULL WHERE id = ? AND status = 'unverified'")
      .run(now, req.id);
    return Number(res.changes) === 1 ? this.get(req.id) : undefined;
  }

  /** Asked again before confirming: the new details and a fresh link replace the old ones. */
  renew(id: number, r: NewRequest) {
    this.db
      .prepare(
        `UPDATE requests SET name = ?, community = ?, about = ?, city = ?, verify_hash = ?, verify_expires = ?
         WHERE id = ? AND status = 'unverified'`,
      )
      .run(r.name, r.community, r.about, r.city, r.verifyHash, r.verifyExpires, id);
  }

  list(statuses: Status[]): AccessRequest[] {
    const marks = statuses.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT * FROM requests WHERE status IN (${marks}) ORDER BY id DESC LIMIT 200`)
      .all(...statuses) as Row[];
    return rows.map(toRequest);
  }

  /** Moves a request from one status to another; false if it was not in `from`. */
  transition(id: number, from: Status[], to: Status, now: number, extra: Partial<Pick<AccessRequest, "tenant" | "maxCommunities" | "maxLogBytes" | "maxBlobBytes" | "reason">> = {}): boolean {
    const sets = ["status = ?", "decided_at = ?"];
    const values: (string | number | null)[] = [to, now];
    const columns: Record<string, string> = {
      tenant: "tenant",
      maxCommunities: "max_communities",
      maxLogBytes: "max_log_bytes",
      maxBlobBytes: "max_blob_bytes",
      reason: "reason",
    };
    for (const [k, col] of Object.entries(columns)) {
      const v = extra[k as keyof typeof extra];
      if (v !== undefined) {
        sets.push(`${col} = ?`);
        values.push(v);
      }
    }
    const marks = from.map(() => "?").join(", ");
    const res = this.db
      .prepare(`UPDATE requests SET ${sets.join(", ")} WHERE id = ? AND status IN (${marks})`)
      .run(...values, id, ...from);
    return Number(res.changes) === 1;
  }

  /** An approval cut short by a restart goes back to the queue; approving it
   * again replaces whatever code the node may already have made. */
  recoverInterrupted() {
    this.db.exec("UPDATE requests SET status = 'pending' WHERE status = 'approving'");
  }

  /** Unconfirmed requests nobody confirmed in time are deleted, with their data. */
  purgeUnverified(before: number) {
    this.db.prepare("DELETE FROM requests WHERE status = 'unverified' AND verify_expires < ?").run(before);
  }
}
