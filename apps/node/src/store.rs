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

/// Schema changes after v0, applied in order and tracked in
/// `PRAGMA user_version`. Never edit an entry once released; append.
const MIGRATIONS: &[&str] = &[
    // 1 — managed hosting (Phase 10): tenants, suspension, moves, usage.
    r#"
    ALTER TABLE communities ADD COLUMN tenant TEXT;
    ALTER TABLE communities ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE communities ADD COLUMN moved_to BLOB;
    ALTER TABLE communities ADD COLUMN log_bytes INTEGER NOT NULL DEFAULT 0;
    UPDATE communities SET log_bytes =
      (SELECT COALESCE(SUM(length(entry)), 0) FROM entries e WHERE e.cid = communities.cid);
    CREATE INDEX IF NOT EXISTS communities_by_tenant ON communities (tenant);
    "#,
    // 2 — moderators (§9.2).
    r#"
    ALTER TABLE communities ADD COLUMN mod_set BLOB;
    "#,
    // 3 — disabled communities, deleted 30 days later (§11.5).
    r#"
    ALTER TABLE communities ADD COLUMN disabled_at INTEGER;
    ALTER TABLE communities ADD COLUMN disabled_by BLOB;
    "#,
    // 4 — encrypted blobs (file attachments, §15): opaque bytes named by
    // their SHA-256, plus a running total per community for the quota.
    r#"
    CREATE TABLE IF NOT EXISTS blobs (
      cid     BLOB NOT NULL REFERENCES communities(cid),
      blob_id BLOB NOT NULL,                  -- SHA-256 of body
      size    INTEGER NOT NULL,
      at      INTEGER NOT NULL,
      body    BLOB NOT NULL,
      PRIMARY KEY (cid, blob_id)
    );
    CREATE INDEX IF NOT EXISTS blobs_by_time ON blobs (cid, at, blob_id);
    ALTER TABLE communities ADD COLUMN blob_bytes INTEGER NOT NULL DEFAULT 0;
    "#,
    // 5 — tenants added through the operator API (managed-hosting.md), next
    // to the ones in the config file. Only the token's SHA-256 is kept. A
    // revoked tenant keeps its row, so its communities keep their limits.
    r#"
    CREATE TABLE IF NOT EXISTS tenants (
      name                 TEXT PRIMARY KEY,
      token_sha256         TEXT NOT NULL UNIQUE,
      max_communities      INTEGER,
      max_log_bytes        INTEGER,
      max_blob_bytes_total INTEGER,
      created_at           INTEGER NOT NULL,
      revoked_at           INTEGER
    );
    "#,
    // 6 — push tokens (§14): where to send a content-free wake-up for a
    // mailbox. One per mailbox; the device replaces it when it changes.
    r#"
    CREATE TABLE IF NOT EXISTS push_tokens (
      cid        BLOB NOT NULL REFERENCES communities(cid),
      mbx        BLOB NOT NULL,
      token      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (cid, mbx)
    );
    "#,
];

pub const SCHEMA_VERSION: usize = MIGRATIONS.len();

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)?;
    let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
            Some(format!(
                "database schema version {version} is newer than this binary supports \
                 ({SCHEMA_VERSION}); run a newer community-node"
            )),
        ));
    }
    for (i, m) in MIGRATIONS.iter().enumerate().skip(version) {
        let tx = conn.transaction()?;
        tx.execute_batch(m)?;
        tx.pragma_update(None, "user_version", i + 1)?;
        tx.commit()?;
        tracing::info!(version = i + 1, "database schema migrated");
    }
    Ok(())
}

/// The node-enforced state of one community (protocol.md §5).
#[derive(Clone, Debug)]
pub struct Community {
    pub cid: Cid,
    pub crk: [u8; 32],
    pub epoch: u32,
    pub rotated_at: u64,
    pub admin_set: Vec<[u8; 32]>,
    /// Moderators (`mod.set`): may read intake, rotate and upload snapshots.
    pub mod_set: Vec<[u8; 32]>,
    pub head_seq: u64,
    pub head_hash: [u8; 32],
    pub head_at: u64,
    pub compacted_through: u64,
    pub intake_mode: String,
    /// Managed hosting: which tenant provisioned it (None: the node's own token).
    pub tenant: Option<String>,
    /// Suspended by the operator: reads and export work, writes do not.
    pub suspended: bool,
    /// After an accepted `migrate` (§11.3): where the community went.
    /// Empty when it lives here.
    pub moved_to: Vec<String>,
    /// Bytes of log entries currently stored, for quotas and usage.
    pub log_bytes: u64,
    /// Bytes of blobs (file attachments, §15) currently stored, for quotas
    /// and usage. Kept in step with the `blobs` table by `insert_blob` and
    /// `delete_blob`.
    pub blob_bytes: u64,
    /// Set by an accepted `disable` (§11.5): when (node time) and by whom.
    /// Writes are refused; housekeeping deletes the community 30 days later.
    pub disabled: Option<(u64, [u8; 32])>,
}

impl Community {
    pub fn new(cid: Cid, crk: [u8; 32], admin_set: Vec<[u8; 32]>, rotated_at: u64) -> Community {
        Community {
            cid,
            crk,
            epoch: 0,
            rotated_at,
            admin_set,
            mod_set: Vec::new(),
            disabled: None,
            head_seq: 0,
            head_hash: [0; 32],
            head_at: 0,
            compacted_through: 0,
            intake_mode: "open".into(),
            tenant: None,
            suspended: false,
            moved_to: Vec::new(),
            log_bytes: 0,
            blob_bytes: 0,
        }
    }
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

fn encode_urls(urls: &[String]) -> Option<Vec<u8>> {
    if urls.is_empty() {
        return None;
    }
    Some(cbor::encode(&Value::Array(
        urls.iter().map(|u| Value::Text(u.clone())).collect(),
    )))
}

pub fn decode_urls(raw: Option<Vec<u8>>) -> Vec<String> {
    match raw.as_deref().map(cbor::decode) {
        Some(Ok(Value::Array(items))) => items
            .iter()
            .filter_map(|v| v.as_text().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    }
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
        let mut conn = Connection::open(path)?;
        migrate(&mut conn)?;
        Ok(Store { conn })
    }

    pub fn open_in_memory() -> rusqlite::Result<Store> {
        let mut conn = Connection::open_in_memory()?;
        migrate(&mut conn)?;
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
        "SELECT crk, epoch, rotated_at, admin_set, head_seq, head_hash, head_at, compacted_through, intake_mode,
                tenant, suspended, moved_to, log_bytes, mod_set, disabled_at, disabled_by, blob_bytes
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
                tenant: r.get(9)?,
                suspended: r.get(10)?,
                moved_to: decode_urls(r.get(11)?),
                log_bytes: r.get(12)?,
                mod_set: r.get::<_, Option<Vec<u8>>>(13)?.map(|b| decode_keys(&b)).unwrap_or_default(),
                disabled: match (r.get::<_, Option<u64>>(14)?, r.get::<_, Option<Vec<u8>>>(15)?) {
                    (Some(at), Some(by)) => Some((at, blob32(by)?)),
                    _ => None,
                },
                blob_bytes: r.get(16)?,
            })
        },
    )
    .optional()
}

pub fn insert_community(c: &Connection, cm: &Community, now: u64) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO communities
           (cid, crk, epoch, rotated_at, admin_set, head_seq, head_hash, head_at, compacted_through, intake_mode, created_at,
            tenant, suspended, moved_to, log_bytes, mod_set, disabled_at, disabled_by, blob_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
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
            now,
            cm.tenant,
            cm.suspended,
            encode_urls(&cm.moved_to),
            cm.log_bytes,
            encode_keys(&cm.mod_set),
            cm.disabled.map(|(at, _)| at),
            cm.disabled.map(|(_, by)| by.to_vec()),
            cm.blob_bytes
        ],
    )?;
    Ok(())
}

pub fn update_community(c: &Connection, cm: &Community) -> rusqlite::Result<()> {
    c.execute(
        "UPDATE communities SET epoch = ?2, rotated_at = ?3, admin_set = ?4, head_seq = ?5, head_hash = ?6,
           head_at = ?7, compacted_through = ?8, intake_mode = ?9, tenant = ?10, suspended = ?11,
           moved_to = ?12, log_bytes = ?13, mod_set = ?14, disabled_at = ?15, disabled_by = ?16,
           blob_bytes = ?17
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
            cm.intake_mode,
            cm.tenant,
            cm.suspended,
            encode_urls(&cm.moved_to),
            cm.log_bytes,
            encode_keys(&cm.mod_set),
            cm.disabled.map(|(at, _)| at),
            cm.disabled.map(|(_, by)| by.to_vec()),
            cm.blob_bytes
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

pub fn communities_of_tenant(c: &Connection, tenant: &str) -> rusqlite::Result<u64> {
    c.query_row(
        "SELECT COUNT(*) FROM communities WHERE tenant = ?1",
        [tenant],
        |r| r.get(0),
    )
}

/// A tenant the operator API added (managed-hosting.md).
#[derive(Clone, Debug)]
pub struct StoredTenant {
    pub tenant: crate::app::Tenant,
    pub created_at: u64,
    pub revoked_at: Option<u64>,
}

const TENANT_COLUMNS: &str =
    "name, token_sha256, max_communities, max_log_bytes, max_blob_bytes_total, created_at, revoked_at";

fn tenant_row(r: &rusqlite::Row) -> rusqlite::Result<StoredTenant> {
    Ok(StoredTenant {
        tenant: crate::app::Tenant {
            name: r.get(0)?,
            token_sha256: r.get(1)?,
            max_communities: r.get(2)?,
            max_log_bytes: r.get(3)?,
            max_blob_bytes_total: r.get(4)?,
        },
        created_at: r.get(5)?,
        revoked_at: r.get(6)?,
    })
}

/// A stored tenant by name, revoked or not.
pub fn tenant(c: &Connection, name: &str) -> rusqlite::Result<Option<StoredTenant>> {
    c.query_row(
        &format!("SELECT {TENANT_COLUMNS} FROM tenants WHERE name = ?1"),
        [name],
        tenant_row,
    )
    .optional()
}

/// The stored tenant whose token hashes to `token_sha256`, unless revoked.
pub fn active_tenant_by_hash(
    c: &Connection,
    token_sha256: &str,
) -> rusqlite::Result<Option<StoredTenant>> {
    c.query_row(
        &format!(
            "SELECT {TENANT_COLUMNS} FROM tenants WHERE token_sha256 = ?1 AND revoked_at IS NULL"
        ),
        [token_sha256],
        tenant_row,
    )
    .optional()
}

pub fn tenants(c: &Connection) -> rusqlite::Result<Vec<StoredTenant>> {
    let mut st = c.prepare(&format!(
        "SELECT {TENANT_COLUMNS} FROM tenants ORDER BY created_at, name"
    ))?;
    let rows = st.query_map([], tenant_row)?;
    rows.collect()
}

pub fn active_tenant_count(c: &Connection) -> rusqlite::Result<u64> {
    c.query_row(
        "SELECT COUNT(*) FROM tenants WHERE revoked_at IS NULL",
        [],
        |r| r.get(0),
    )
}

pub fn insert_tenant(c: &Connection, t: &crate::app::Tenant, now: u64) -> rusqlite::Result<()> {
    c.execute(
        &format!("INSERT INTO tenants ({TENANT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)"),
        params![
            t.name,
            t.token_sha256,
            t.max_communities,
            t.max_log_bytes,
            t.max_blob_bytes_total,
            now
        ],
    )?;
    Ok(())
}

/// A new token for a stored tenant; also lifts a revocation.
pub fn set_tenant_token(c: &Connection, name: &str, token_sha256: &str) -> rusqlite::Result<bool> {
    Ok(c.execute(
        "UPDATE tenants SET token_sha256 = ?2, revoked_at = NULL WHERE name = ?1",
        params![name, token_sha256],
    )? == 1)
}

/// Replaces a stored tenant's limits; `None` means no limit (or, for blobs,
/// the node's default).
pub fn set_tenant_limits(c: &Connection, t: &crate::app::Tenant) -> rusqlite::Result<bool> {
    Ok(c.execute(
        "UPDATE tenants SET max_communities = ?2, max_log_bytes = ?3, max_blob_bytes_total = ?4 WHERE name = ?1",
        params![t.name, t.max_communities, t.max_log_bytes, t.max_blob_bytes_total],
    )? == 1)
}

pub fn revoke_tenant(c: &Connection, name: &str, now: u64) -> rusqlite::Result<bool> {
    Ok(c.execute(
        "UPDATE tenants SET revoked_at = COALESCE(revoked_at, ?2) WHERE name = ?1",
        params![name, now],
    )? == 1)
}

/// Communities disabled at or before `cutoff` (node time), due for deletion (§11.5).
pub fn disabled_before(c: &Connection, cutoff: u64) -> rusqlite::Result<Vec<Cid>> {
    let mut st = c.prepare(
        "SELECT cid FROM communities WHERE disabled_at IS NOT NULL AND disabled_at <= ?1",
    )?;
    let rows = st.query_map([cutoff], |r| blob32(r.get(0)?))?;
    rows.collect()
}

// ---------------------------------------------------------------------------
// Blobs (§15): opaque encrypted files named by the SHA-256 of their bytes.
// ---------------------------------------------------------------------------

/// One row of `GET /c/{cid}/blobs`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlobInfo {
    pub blob_id: [u8; 32],
    pub size: u64,
    pub at: u64,
}

pub fn blob(c: &Connection, cid: &Cid, blob_id: &[u8; 32]) -> rusqlite::Result<Option<Vec<u8>>> {
    c.query_row(
        "SELECT body FROM blobs WHERE cid = ?1 AND blob_id = ?2",
        params![cid, blob_id],
        |r| r.get(0),
    )
    .optional()
}

pub fn blob_size(c: &Connection, cid: &Cid, blob_id: &[u8; 32]) -> rusqlite::Result<Option<u64>> {
    c.query_row(
        "SELECT size FROM blobs WHERE cid = ?1 AND blob_id = ?2",
        params![cid, blob_id],
        |r| r.get(0),
    )
    .optional()
}

/// Stores a blob and adds its size to the community's running total. The
/// caller checks the quota first, inside the same transaction, so the check
/// and the insert are atomic.
pub fn insert_blob(
    c: &Connection,
    cid: &Cid,
    blob_id: &[u8; 32],
    body: &[u8],
    now: u64,
) -> rusqlite::Result<()> {
    let size = body.len() as u64;
    c.execute(
        "INSERT INTO blobs (cid, blob_id, size, at, body) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![cid, blob_id, size, now, body],
    )?;
    c.execute(
        "UPDATE communities SET blob_bytes = blob_bytes + ?2 WHERE cid = ?1",
        params![cid, size],
    )?;
    Ok(())
}

/// Removes a blob and frees its quota. Returns the size freed, or `None`
/// when there was no such blob.
pub fn delete_blob(c: &Connection, cid: &Cid, blob_id: &[u8; 32]) -> rusqlite::Result<Option<u64>> {
    let Some(size) = blob_size(c, cid, blob_id)? else {
        return Ok(None);
    };
    c.execute(
        "DELETE FROM blobs WHERE cid = ?1 AND blob_id = ?2",
        params![cid, blob_id],
    )?;
    c.execute(
        "UPDATE communities SET blob_bytes = MAX(0, blob_bytes - ?2) WHERE cid = ?1",
        params![cid, size],
    )?;
    Ok(Some(size))
}

/// Every blob of a community, oldest first (ties broken by id), so admins
/// can reconcile against the community state and delete orphans.
pub fn blobs(c: &Connection, cid: &Cid) -> rusqlite::Result<Vec<BlobInfo>> {
    let mut st = c.prepare_cached(
        "SELECT blob_id, size, at FROM blobs WHERE cid = ?1 ORDER BY at, blob_id",
    )?;
    let rows = st.query_map([cid], |r| {
        Ok(BlobInfo {
            blob_id: blob32(r.get(0)?)?,
            size: r.get(1)?,
            at: r.get(2)?,
        })
    })?;
    rows.collect()
}

// --- push tokens (§14) ------------------------------------------------------

pub fn push_token(c: &Connection, cid: &Cid, mbx: &[u8; 32]) -> rusqlite::Result<Option<String>> {
    c.query_row(
        "SELECT token FROM push_tokens WHERE cid = ?1 AND mbx = ?2",
        params![cid, mbx],
        |r| r.get(0),
    )
    .optional()
}

pub fn set_push_token(
    c: &Connection,
    cid: &Cid,
    mbx: &[u8; 32],
    token: &str,
    now: u64,
) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO push_tokens (cid, mbx, token, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (cid, mbx) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at",
        params![cid, mbx, token, now],
    )?;
    Ok(())
}

/// Drops the token; with `only` set, only when it is still that token (a
/// gateway said it is dead, but the device may have registered a new one).
pub fn delete_push_token(
    c: &Connection,
    cid: &Cid,
    mbx: &[u8; 32],
    only: Option<&str>,
) -> rusqlite::Result<bool> {
    let n = match only {
        Some(t) => c.execute(
            "DELETE FROM push_tokens WHERE cid = ?1 AND mbx = ?2 AND token = ?3",
            params![cid, mbx, t],
        )?,
        None => c.execute(
            "DELETE FROM push_tokens WHERE cid = ?1 AND mbx = ?2",
            params![cid, mbx],
        )?,
    };
    Ok(n > 0)
}

/// Removes every row of a community. Irreversible; the operator API asks for confirmation.
pub fn delete_community(c: &Connection, cid: &Cid) -> rusqlite::Result<bool> {
    for table in [
        "entries",
        "op_ids",
        "epochs",
        "snapshots",
        "mailbox",
        "intake",
        "invites",
        "directory",
        "blobs",
        "push_tokens",
    ] {
        c.execute(&format!("DELETE FROM {table} WHERE cid = ?1"), [cid])?;
    }
    Ok(c.execute("DELETE FROM communities WHERE cid = ?1", [cid])? > 0)
}
