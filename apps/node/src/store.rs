//! SQLite persistence. One file holds every community this node hosts.
//!
//! Everything stored is either public key material, signatures, protocol
//! metadata or ciphertext the node cannot read (protocol.md §29 of the
//! architecture, threat-model.md scenario 3).

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use vv_crypto::cbor::{self, Value};

pub type Cid = [u8; 32];

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS communities (
  cid               BLOB PRIMARY KEY,
  crk               BLOB NOT NULL,
  epoch             INTEGER NOT NULL,
  rotated_at        INTEGER NOT NULL,
  admin_set         BLOB NOT NULL,          -- CBOR array of 32-byte keys
  head_seq          INTEGER NOT NULL,
  head_hash         BLOB NOT NULL,
  head_at           INTEGER NOT NULL,
  compacted_through INTEGER NOT NULL DEFAULT 0,
  intake_mode       TEXT NOT NULL DEFAULT 'open',
  created_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS epochs (
  cid   BLOB NOT NULL REFERENCES communities(cid),
  epoch INTEGER NOT NULL,
  eak   BLOB NOT NULL,
  PRIMARY KEY (cid, epoch)
);

CREATE TABLE IF NOT EXISTS entries (
  cid   BLOB NOT NULL REFERENCES communities(cid),
  seq   INTEGER NOT NULL,
  plane TEXT NOT NULL,
  entry BLOB NOT NULL,                      -- CBOR LogEntry
  PRIMARY KEY (cid, seq)
);

CREATE TABLE IF NOT EXISTS op_ids (
  cid      BLOB NOT NULL REFERENCES communities(cid),
  op_id    BLOB NOT NULL,
  seq      INTEGER NOT NULL,
  env_hash BLOB NOT NULL,
  PRIMARY KEY (cid, op_id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  cid       BLOB NOT NULL REFERENCES communities(cid),
  seq       INTEGER NOT NULL,
  env       BLOB NOT NULL,
  stored_at INTEGER NOT NULL,
  PRIMARY KEY (cid, seq)
);

CREATE TABLE IF NOT EXISTS mailbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cid        BLOB NOT NULL REFERENCES communities(cid),
  mbx        BLOB NOT NULL,
  kind       TEXT NOT NULL,
  ct         BLOB NOT NULL,
  posted_at  INTEGER NOT NULL,
  expires_at INTEGER                        -- NULL: until acknowledged
);
CREATE INDEX IF NOT EXISTS mailbox_by_box ON mailbox (cid, mbx, id);

CREATE TABLE IF NOT EXISTS intake (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  cid BLOB NOT NULL REFERENCES communities(cid),
  enc BLOB NOT NULL,
  ct  BLOB NOT NULL,
  at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  cid        BLOB NOT NULL REFERENCES communities(cid),
  hash       BLOB NOT NULL,
  expires_at INTEGER NOT NULL,
  uses_left  INTEGER NOT NULL,
  PRIMARY KEY (cid, hash)
);

CREATE TABLE IF NOT EXISTS directory (
  cid   BLOB PRIMARY KEY REFERENCES communities(cid),
  entry BLOB NOT NULL
);
"#;

/// The node-enforced state of one community (protocol.md §5).
#[derive(Clone, Debug)]
pub struct Community {
    pub cid: Cid,
    pub crk: [u8; 32],
    pub epoch: u32,
    pub rotated_at: u64,
    pub admin_set: Vec<[u8; 32]>,
    pub head_seq: u64,
    pub head_hash: [u8; 32],
    pub head_at: u64,
    pub compacted_through: u64,
    pub intake_mode: String,
}

pub struct Store {
    conn: Connection,
}

fn blob32(v: Vec<u8>) -> rusqlite::Result<[u8; 32]> {
    v.try_into().map_err(|_| {
        rusqlite::Error::InvalidColumnType(0, "blob32".into(), rusqlite::types::Type::Blob)
    })
}

pub fn encode_keys(keys: &[[u8; 32]]) -> Vec<u8> {
    cbor::encode(&Value::Array(
        keys.iter().map(|k| Value::Bytes(k.to_vec())).collect(),
    ))
}

fn decode_keys(raw: &[u8]) -> Vec<[u8; 32]> {
    match cbor::decode(raw) {
        Ok(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_bytes().and_then(|b| <[u8; 32]>::try_from(b).ok()))
            .collect(),
        _ => Vec::new(),
    }
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Store> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    pub fn open_in_memory() -> rusqlite::Result<Store> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    pub fn tx(&mut self) -> rusqlite::Result<Transaction<'_>> {
        self.conn.transaction()
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn meta(&self, k: &str) -> rusqlite::Result<Option<Vec<u8>>> {
        self.conn
            .query_row("SELECT v FROM meta WHERE k = ?1", [k], |r| r.get(0))
            .optional()
    }

    pub fn set_meta(&self, k: &str, v: &[u8]) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)",
            params![k, v],
        )?;
        Ok(())
    }
}

// Queries usable on a connection or inside a transaction.

pub fn community(c: &Connection, cid: &Cid) -> rusqlite::Result<Option<Community>> {
    c.query_row(
        "SELECT crk, epoch, rotated_at, admin_set, head_seq, head_hash, head_at, compacted_through, intake_mode
         FROM communities WHERE cid = ?1",
        [cid],
        |r| {
            Ok(Community {
                cid: *cid,
                crk: blob32(r.get(0)?)?,
                epoch: r.get(1)?,
                rotated_at: r.get(2)?,
                admin_set: decode_keys(&r.get::<_, Vec<u8>>(3)?),
                head_seq: r.get(4)?,
                head_hash: blob32(r.get(5)?)?,
                head_at: r.get(6)?,
                compacted_through: r.get(7)?,
                intake_mode: r.get(8)?,
            })
        },
    )
    .optional()
}

pub fn insert_community(c: &Connection, cm: &Community, now: u64) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO communities
           (cid, crk, epoch, rotated_at, admin_set, head_seq, head_hash, head_at, compacted_through, intake_mode, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            cm.cid,
            cm.crk,
            cm.epoch,
            cm.rotated_at,
            encode_keys(&cm.admin_set),
            cm.head_seq,
            cm.head_hash,
            cm.head_at,
            cm.compacted_through,
            cm.intake_mode,
            now
        ],
    )?;
    Ok(())
}

pub fn update_community(c: &Connection, cm: &Community) -> rusqlite::Result<()> {
    c.execute(
        "UPDATE communities SET epoch = ?2, rotated_at = ?3, admin_set = ?4, head_seq = ?5, head_hash = ?6,
           head_at = ?7, compacted_through = ?8, intake_mode = ?9
         WHERE cid = ?1",
        params![
            cm.cid,
            cm.epoch,
            cm.rotated_at,
            encode_keys(&cm.admin_set),
            cm.head_seq,
            cm.head_hash,
            cm.head_at,
            cm.compacted_through,
            cm.intake_mode
        ],
    )?;
    Ok(())
}

pub fn eak(c: &Connection, cid: &Cid, epoch: u32) -> rusqlite::Result<Option<[u8; 32]>> {
    c.query_row(
        "SELECT eak FROM epochs WHERE cid = ?1 AND epoch = ?2",
        params![cid, epoch],
        |r| blob32(r.get(0)?),
    )
    .optional()
}

pub fn insert_eak(c: &Connection, cid: &Cid, epoch: u32, eak: &[u8; 32]) -> rusqlite::Result<()> {
    c.execute(
        "INSERT OR REPLACE INTO epochs (cid, epoch, eak) VALUES (?1, ?2, ?3)",
        params![cid, epoch, eak],
    )?;
    Ok(())
}

pub fn op_id(
    c: &Connection,
    cid: &Cid,
    op_id: &[u8; 16],
) -> rusqlite::Result<Option<(u64, Vec<u8>)>> {
    c.query_row(
        "SELECT seq, env_hash FROM op_ids WHERE cid = ?1 AND op_id = ?2",
        params![cid, op_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
}

pub fn insert_entry(
    c: &Connection,
    cid: &Cid,
    seq: u64,
    plane: &str,
    entry: &[u8],
    op_id: &[u8; 16],
    env_hash: &[u8; 32],
) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO entries (cid, seq, plane, entry) VALUES (?1, ?2, ?3, ?4)",
        params![cid, seq, plane, entry],
    )?;
    c.execute(
        "INSERT OR REPLACE INTO op_ids (cid, op_id, seq, env_hash) VALUES (?1, ?2, ?3, ?4)",
        params![cid, op_id, seq, env_hash],
    )?;
    Ok(())
}

pub fn entries_after(
    c: &Connection,
    cid: &Cid,
    after: u64,
    limit: u32,
) -> rusqlite::Result<Vec<Vec<u8>>> {
    let mut st = c.prepare_cached(
        "SELECT entry FROM entries WHERE cid = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3",
    )?;
    let rows = st.query_map(params![cid, after, limit], |r| r.get(0))?;
    rows.collect()
}

pub fn entry_at(c: &Connection, cid: &Cid, seq: u64) -> rusqlite::Result<Option<Vec<u8>>> {
    c.query_row(
        "SELECT entry FROM entries WHERE cid = ?1 AND seq = ?2",
        params![cid, seq],
        |r| r.get(0),
    )
    .optional()
}

pub fn control_entries(c: &Connection, cid: &Cid) -> rusqlite::Result<Vec<Vec<u8>>> {
    let mut st =
        c.prepare_cached("SELECT entry FROM entries WHERE cid = ?1 AND plane = 'c' ORDER BY seq")?;
    let rows = st.query_map([cid], |r| r.get(0))?;
    rows.collect()
}

pub fn communities(c: &Connection) -> rusqlite::Result<Vec<Cid>> {
    let mut st = c.prepare("SELECT cid FROM communities")?;
    let rows = st.query_map([], |r| blob32(r.get(0)?))?;
    rows.collect()
}
