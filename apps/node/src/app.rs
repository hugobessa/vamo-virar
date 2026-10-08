//! Shared node state: configuration, clock, the store, auth sessions,
//! notification channels and housekeeping.

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tokio::sync::broadcast;
use vv_crypto::primitives::public_key;

use crate::store::{self, Cid, Store};

#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Address to listen on.
    pub listen: String,
    /// Directory for `node.sqlite`.
    pub data_dir: PathBuf,
    /// If set, creating or restoring a community requires this token in
    /// `x-vv-provision-token`. If unset, provisioning is closed unless
    /// `open_provisioning` is true.
    pub provisioning_token: Option<String>,
    pub open_provisioning: bool,
    /// How long ops under the previous epoch are accepted after a rotation (§7.4).
    pub epoch_grace_secs: u64,
    /// How long a snapshot must exist before the log prefix it covers is deleted (§12.4).
    pub compaction_grace_secs: u64,
    pub session_ttl_secs: u64,
    pub max_batch: usize,
    pub max_mailbox_items: u32,
    pub max_mailbox_ttl_secs: u64,
    pub intake_per_ip_per_hour: u32,
    pub intake_per_community_per_hour: u32,
    /// How often expiry and compaction run.
    pub housekeeping_interval_secs: u64,
    /// Behind a reverse proxy (Caddy, nginx): take the client address for
    /// rate limiting from the last `X-Forwarded-For` hop, which the proxy
    /// appends. Leave false when clients connect directly, or anyone could
    /// pick their own address.
    pub trust_forwarded_for: bool,
    /// Managed hosting: address of the operator API (usage, suspension,
    /// export, metrics). Never expose it publicly. Off when unset.
    pub operator_listen: Option<String>,
    /// Bearer token for the operator API. Required with `operator_listen`.
    pub operator_token: Option<String>,
    /// Managed hosting: customers who may provision communities with their
    /// own token, each with optional limits.
    pub tenants: Vec<Tenant>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tenant {
    pub name: String,
    /// Lowercase hex SHA-256 of the tenant's provisioning token, so the
    /// config file never holds the token itself (`community-node tenant-token`).
    pub token_sha256: String,
    pub max_communities: Option<u64>,
    /// Bytes of log entries one community may hold. Snapshots let the node
    /// compact the log, which frees quota.
    pub max_log_bytes: Option<u64>,
}

impl Config {
    /// Rejects settings that would fail later or silently do nothing.
    pub fn validate(&self) -> Result<(), String> {
        if self.operator_listen.is_some()
            && self.operator_token.as_deref().is_none_or(|t| t.len() < 16)
        {
            return Err("operator_listen needs operator_token (at least 16 characters)".into());
        }
        let mut names = std::collections::HashSet::new();
        for t in &self.tenants {
            if t.name.is_empty() || t.name.len() > 64 || !names.insert(t.name.as_str()) {
                return Err(format!(
                    "tenant names must be unique and 1-64 characters: {:?}",
                    t.name
                ));
            }
            if unhex::<32>(&t.token_sha256).is_none() {
                return Err(format!(
                    "tenant {}: token_sha256 must be 64 lowercase hex characters",
                    t.name
                ));
            }
        }
        Ok(())
    }

    pub fn tenant(&self, name: Option<&str>) -> Option<&Tenant> {
        let name = name?;
        self.tenants.iter().find(|t| t.name == name)
    }

    /// The tenant's quota for a community, if it has one.
    pub fn max_log_bytes(&self, tenant: Option<&str>) -> Option<u64> {
        self.tenant(tenant).and_then(|t| t.max_log_bytes)
    }
}

/// Constant-time comparison for secrets.
pub fn same_secret(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl Default for Config {
    fn default() -> Self {
        Config {
            listen: "127.0.0.1:8787".into(),
            data_dir: PathBuf::from("./data"),
            provisioning_token: None,
            open_provisioning: false,
            epoch_grace_secs: 600,
            compaction_grace_secs: 30 * 24 * 3600,
            session_ttl_secs: 3600,
            max_batch: 100,
            max_mailbox_items: 1000,
            max_mailbox_ttl_secs: 30 * 24 * 3600,
            intake_per_ip_per_hour: 20,
            intake_per_community_per_hour: 200,
            housekeeping_interval_secs: 60,
            trust_forwarded_for: false,
            operator_listen: None,
            operator_token: None,
            tenants: Vec::new(),
        }
    }
}

/// Wall clock with an adjustable offset, so tests can move time forward.
#[derive(Default)]
pub struct Clock {
    offset_ms: AtomicU64,
}

impl Clock {
    pub fn now(&self) -> u64 {
        let wall = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        wall + self.offset_ms.load(Ordering::Relaxed)
    }

    pub fn advance(&self, ms: u64) {
        self.offset_ms.fetch_add(ms, Ordering::Relaxed);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Community,
    Mailbox,
    Control,
}

impl Scope {
    pub fn parse(s: &str) -> Option<Scope> {
        match s {
            "community" => Some(Scope::Community),
            "mailbox" => Some(Scope::Mailbox),
            "control" => Some(Scope::Control),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Session {
    pub cid: Cid,
    pub scope: Scope,
    pub key: [u8; 32],
    pub mailbox: [u8; 32],
    pub expires_at: u64,
}

#[derive(Clone, Debug)]
pub enum Notice {
    Head(u64),
    Mailbox([u8; 32]),
}

pub struct App {
    pub config: Config,
    pub clock: Clock,
    pub store: Mutex<Store>,
    pub node_seed: [u8; 32],
    pub node_id: [u8; 32],
    pub challenges: Mutex<HashMap<[u8; 32], (Cid, u64)>>,
    pub sessions: Mutex<HashMap<String, Session>>,
    streams: Mutex<HashMap<Cid, broadcast::Sender<Notice>>>,
    rate: Mutex<HashMap<String, (u64, u32)>>,
}

pub fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("OS random number generator");
    b
}

impl App {
    pub fn new(config: Config, store: Store) -> rusqlite::Result<App> {
        // The node's own identity (§11.1), generated once and kept in the store.
        let node_seed: [u8; 32] = match store.meta("node_seed")? {
            Some(v) if v.len() == 32 => v.try_into().expect("checked length"),
            _ => {
                let seed = random();
                store.set_meta("node_seed", &seed)?;
                seed
            }
        };
        Ok(App {
            config,
            clock: Clock::default(),
            store: Mutex::new(store),
            node_id: public_key(&node_seed),
            node_seed,
            challenges: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
            streams: Mutex::new(HashMap::new()),
            rate: Mutex::new(HashMap::new()),
        })
    }

    pub fn epoch_grace_ms(&self) -> u64 {
        self.config.epoch_grace_secs * 1000
    }

    pub fn subscribe(&self, cid: &Cid) -> broadcast::Receiver<Notice> {
        let mut s = self.streams.lock().unwrap();
        s.entry(*cid)
            .or_insert_with(|| broadcast::channel(256).0)
            .subscribe()
    }

    pub fn notify(&self, cid: &Cid, n: Notice) {
        if let Some(tx) = self.streams.lock().unwrap().get(cid) {
            let _ = tx.send(n);
        }
    }

    /// Fixed-window rate limit. Returns false when `key` exceeded `per_hour`.
    pub fn rate_ok(&self, key: String, per_hour: u32) -> bool {
        let now = self.clock.now();
        let mut r = self.rate.lock().unwrap();
        let e = r.entry(key).or_insert((now, 0));
        if now - e.0 > 3_600_000 {
            *e = (now, 0);
        }
        e.1 += 1;
        e.1 <= per_hour
    }

    pub fn ip_key(ip: Option<IpAddr>) -> String {
        ip.map(|i| i.to_string())
            .unwrap_or_else(|| "unknown".into())
    }

    /// Periodic cleanup: expired auth state, mailbox items and rate windows,
    /// and log compaction behind old-enough snapshots (§12.4).
    pub fn housekeeping(&self) -> rusqlite::Result<()> {
        let now = self.clock.now();
        self.challenges
            .lock()
            .unwrap()
            .retain(|_, (_, exp)| *exp > now);
        self.sessions
            .lock()
            .unwrap()
            .retain(|_, s| s.expires_at > now);
        self.rate
            .lock()
            .unwrap()
            .retain(|_, (start, _)| now - *start <= 3_600_000);

        let mut st = self.store.lock().unwrap();
        let tx = st.tx()?;
        tx.execute(
            "DELETE FROM mailbox WHERE expires_at IS NOT NULL AND expires_at <= ?1",
            [now],
        )?;
        let grace = self.config.compaction_grace_secs * 1000;
        for cid in store::communities(&tx)? {
            let latest: Option<(u64, u64)> = tx
                .query_row(
                    "SELECT seq, stored_at FROM snapshots WHERE cid = ?1 ORDER BY seq DESC LIMIT 1",
                    [cid],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();
            let Some((seq, stored_at)) = latest else {
                continue;
            };
            let Some(mut cm) = store::community(&tx, &cid)? else {
                continue;
            };
            if now.saturating_sub(stored_at) < grace || seq <= cm.compacted_through {
                continue;
            }
            // Control-plane entries are kept forever (they are tiny and needed for restore).
            let freed: u64 = tx.query_row(
                "SELECT COALESCE(SUM(length(entry)), 0) FROM entries WHERE cid = ?1 AND seq <= ?2 AND plane = 'd'",
                rusqlite::params![cid, seq],
                |r| r.get(0),
            )?;
            tx.execute(
                "DELETE FROM entries WHERE cid = ?1 AND seq <= ?2 AND plane = 'd'",
                rusqlite::params![cid, seq],
            )?;
            cm.compacted_through = seq;
            cm.log_bytes = cm.log_bytes.saturating_sub(freed);
            store::update_community(&tx, &cm)?;
            tracing::info!(cid = %hex(&cid), through = seq, "compacted log");
        }
        tx.commit()
    }
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn unhex<const N: usize>(s: &str) -> Option<[u8; N]> {
    if s.len() != 2 * N
        || !s
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return None;
    }
    let mut out = [0u8; N];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}
