//! HTTP + WebSocket API (protocol.md §15). Request and response bodies are
//! deterministic CBOR (`application/cbor`); identifiers in paths are hex.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::{to_bytes, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::Router;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use vv_crypto::cbor::{self, Value};
use vv_crypto::ctx;
use vv_crypto::envelope::{LogEntry, OpEnvelope};
use vv_crypto::keys::mailbox_id;
use vv_crypto::primitives::{hash_ctx, verify};
use vv_crypto::snapshot::SnapshotEnvelope;

use crate::app::{hex, random, unhex, App, Notice, Scope, Session};
use crate::sequencer::{self, Reject, SeqError};
use crate::store::{self, Cid};

pub const PROTOCOL: &str = "vv/0";
const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_MAILBOX_CT: usize = 64 * 1024;
const MAX_INTAKE_CT: usize = 16 * 1024;
const MAX_DIRECTORY: usize = 8 * 1024;
const CHALLENGE_TTL_MS: u64 = 60_000;
const MAX_PENDING_CHALLENGES: usize = 100_000;

type Shared = Arc<App>;

pub fn router(app: Shared) -> Router {
    let r = Router::new()
        .route("/.well-known/vamo-virar", get(well_known))
        .route("/v1/auth/challenge", post(challenge))
        .route("/v1/auth/session", post(session))
        .route("/v1/communities", post(create_community))
        .route("/v1/communities/restore", post(restore_community))
        .route("/v1/c/{cid}/ops", post(post_ops).get(get_ops))
        .route("/v1/c/{cid}/control", get(get_control))
        .route("/v1/c/{cid}/snapshot", get(get_snapshot).put(put_snapshot))
        .route(
            "/v1/c/{cid}/mailbox/{mbx}",
            post(post_mailbox).get(get_mailbox),
        )
        .route("/v1/c/{cid}/mailbox/{mbx}/{id}", delete(delete_mailbox))
        .route("/v1/c/{cid}/intake", post(post_intake).get(get_intake))
        .route("/v1/c/{cid}/intake/{id}", delete(delete_intake))
        .route("/v1/c/{cid}/intake-policy", put(put_intake_policy))
        .route("/v1/c/{cid}/invites", post(post_invite))
        .route(
            "/v1/c/{cid}/directory",
            get(get_directory).put(put_directory),
        )
        .route("/v1/c/{cid}/stream", get(stream));
    #[cfg(feature = "test-clock")]
    let r = r.route("/v1/test/clock", post(test_clock));
    r.with_state(app)
}

/// Test builds only: moves the node clock forward and runs housekeeping.
#[cfg(feature = "test-clock")]
async fn test_clock(State(app): State<Shared>, body: Bytes) -> Result<Response, ApiError> {
    let v = parse(&body)?;
    let secs = uint_field(&v, "advance_secs")?;
    app.clock.advance(secs * 1000);
    app.housekeeping()?;
    ok(Value::map([("now", int(app.clock.now()))]))
}

// ---------------------------------------------------------------------------
// Errors and CBOR helpers
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    detail: String,
    extra: Vec<(&'static str, Value)>,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, detail: impl Into<String>) -> Self {
        ApiError {
            status,
            code,
            detail: detail.into(),
            extra: Vec::new(),
        }
    }
    fn bad(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "malformed", detail)
    }
    fn unauthorized(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", detail)
    }
    fn not_hosted() -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "not_hosted",
            "community not hosted here",
        )
    }
    fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", "no such item")
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        tracing::error!(error = %e, "database error");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "storage error",
        )
    }
}

fn reject_status(r: &Reject) -> StatusCode {
    match r {
        Reject::NotHosted => StatusCode::NOT_FOUND,
        Reject::Unauthorized(_) => StatusCode::UNAUTHORIZED,
        Reject::EpochStale | Reject::EpochConflict | Reject::OpConflict | Reject::AlreadyExists => {
            StatusCode::CONFLICT
        }
    }
}

impl From<SeqError> for ApiError {
    fn from(e: SeqError) -> Self {
        match e {
            SeqError::Db(d) => d.into(),
            SeqError::Reject(r) => {
                let detail = match &r {
                    Reject::Unauthorized(why) => why.to_string(),
                    other => other.code().to_string(),
                };
                ApiError::new(reject_status(&r), r.code(), detail)
            }
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut fields = vec![
            ("code", Value::Text(self.code.into())),
            ("detail", Value::Text(self.detail)),
        ];
        fields.extend(self.extra);
        cbor_response(self.status, Value::map(fields))
    }
}

fn cbor_response(status: StatusCode, v: Value) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/cbor")],
        cbor::encode(&v),
    )
        .into_response()
}

fn ok(v: Value) -> Result<Response, ApiError> {
    Ok(cbor_response(StatusCode::OK, v))
}

fn parse(body: &[u8]) -> Result<Value, ApiError> {
    cbor::decode(body).map_err(|e| ApiError::bad(format!("body: {e}")))
}

fn field<'a>(v: &'a Value, k: &str) -> Result<&'a Value, ApiError> {
    v.get(k)
        .ok_or_else(|| ApiError::bad(format!("missing {k}")))
}

fn bytes_field<const N: usize>(v: &Value, k: &str) -> Result<[u8; N], ApiError> {
    field(v, k)?
        .as_bytes()
        .and_then(|b| <[u8; N]>::try_from(b).ok())
        .ok_or_else(|| ApiError::bad(format!("{k} must be {N} bytes")))
}

fn uint_field(v: &Value, k: &str) -> Result<u64, ApiError> {
    field(v, k)?
        .as_uint()
        .ok_or_else(|| ApiError::bad(format!("{k} must be an unsigned integer")))
}

fn cid_param(s: &str) -> Result<Cid, ApiError> {
    unhex::<32>(s).ok_or_else(|| ApiError::bad("community id must be 64 hex characters"))
}

fn b(v: &[u8]) -> Value {
    Value::Bytes(v.to_vec())
}

fn int(n: u64) -> Value {
    Value::Int(n as i64)
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

/// Resolves a session token and re-checks it against current community state,
/// so a rotation or admin change revokes old credentials immediately.
fn authorize_token(
    app: &App,
    token: Option<&str>,
    cid: &Cid,
    scope: Scope,
) -> Result<Session, ApiError> {
    let token = token.ok_or_else(|| ApiError::unauthorized("missing bearer token"))?;
    let s = app
        .sessions
        .lock()
        .unwrap()
        .get(token)
        .cloned()
        .ok_or_else(|| ApiError::unauthorized("unknown token"))?;
    if s.cid != *cid || s.scope != scope || s.expires_at <= app.clock.now() {
        return Err(ApiError::unauthorized("token not valid for this request"));
    }
    let st = app.store.lock().unwrap();
    let cm = store::community(st.conn(), cid)?.ok_or_else(ApiError::not_hosted)?;
    match scope {
        Scope::Community => {
            if !current_or_grace_eak(app, st.conn(), &cm, &s.key)? {
                return Err(ApiError::unauthorized(
                    "epoch access key is no longer current",
                ));
            }
        }
        Scope::Control => {
            if !cm.admin_set.contains(&s.key) {
                return Err(ApiError::unauthorized("not in the admin set"));
            }
        }
        Scope::Mailbox => {}
    }
    Ok(s)
}

fn authorize(app: &App, headers: &HeaderMap, cid: &Cid, scope: Scope) -> Result<Session, ApiError> {
    authorize_token(app, bearer(headers), cid, scope)
}

fn current_or_grace_eak(
    app: &App,
    c: &rusqlite::Connection,
    cm: &store::Community,
    key: &[u8; 32],
) -> Result<bool, ApiError> {
    if store::eak(c, &cm.cid, cm.epoch)?.as_ref() == Some(key) {
        return Ok(true);
    }
    let in_grace = app.clock.now().saturating_sub(cm.rotated_at) < app.epoch_grace_ms();
    if cm.epoch > 0 && in_grace && store::eak(c, &cm.cid, cm.epoch - 1)?.as_ref() == Some(key) {
        return Ok(true);
    }
    Ok(false)
}

fn provisioning_allowed(app: &App, headers: &HeaderMap) -> Result<(), ApiError> {
    match &app.config.provisioning_token {
        Some(expected) => {
            let got = headers
                .get("x-vv-provision-token")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            let same = got.len() == expected.len()
                && got
                    .bytes()
                    .zip(expected.bytes())
                    .fold(0u8, |acc, (a, b)| acc | (a ^ b))
                    == 0;
            if same {
                Ok(())
            } else {
                Err(ApiError::new(
                    StatusCode::FORBIDDEN,
                    "forbidden",
                    "provisioning token required",
                ))
            }
        }
        None if app.config.open_provisioning => Ok(()),
        None => Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "provisioning is closed on this node",
        )),
    }
}

// ---------------------------------------------------------------------------
// Discovery and auth (§3.1, §11.1)
// ---------------------------------------------------------------------------

async fn well_known(State(app): State<Shared>) -> Response {
    let body = format!(
        "{{\"protocol\":\"{PROTOCOL}\",\"node_id\":\"{}\",\"api\":\"/v1\",\"limits\":{{\"max_batch\":{},\"max_op_bytes\":65536}}}}",
        hex(&app.node_id),
        app.config.max_batch
    );
    ([(header::CONTENT_TYPE, "application/json")], body).into_response()
}

async fn challenge(State(app): State<Shared>, body: Bytes) -> Result<Response, ApiError> {
    let v = parse(&body)?;
    let cid: Cid = bytes_field(&v, "community_id")?;
    if store::community(app.store.lock().unwrap().conn(), &cid)?.is_none() {
        return Err(ApiError::not_hosted());
    }
    let nonce: [u8; 32] = random();
    let expires_at = app.clock.now() + CHALLENGE_TTL_MS;
    {
        let mut ch = app.challenges.lock().unwrap();
        if ch.len() >= MAX_PENDING_CHALLENGES {
            let now = app.clock.now();
            ch.retain(|_, (_, exp)| *exp > now);
            if ch.len() >= MAX_PENDING_CHALLENGES {
                return Err(ApiError::new(
                    StatusCode::TOO_MANY_REQUESTS,
                    "rate_limited",
                    "too many pending challenges",
                ));
            }
        }
        ch.insert(nonce, (cid, expires_at));
    }
    ok(Value::map([
        ("nonce", b(&nonce)),
        ("node_id", b(&app.node_id)),
        ("expires_at", int(expires_at)),
    ]))
}

async fn session(State(app): State<Shared>, body: Bytes) -> Result<Response, ApiError> {
    let v = parse(&body)?;
    let cid: Cid = bytes_field(&v, "community_id")?;
    let nonce: [u8; 32] = bytes_field(&v, "nonce")?;
    let key: [u8; 32] = bytes_field(&v, "public_key")?;
    let sig: [u8; 64] = bytes_field(&v, "sig")?;
    let scope_text = field(&v, "scope")?
        .as_text()
        .ok_or_else(|| ApiError::bad("scope"))?;
    let scope = Scope::parse(scope_text).ok_or_else(|| ApiError::bad("unknown scope"))?;

    // Challenges are single use.
    let ch = app.challenges.lock().unwrap().remove(&nonce);
    match ch {
        Some((c, exp)) if c == cid && exp > app.clock.now() => {}
        _ => return Err(ApiError::unauthorized("unknown or expired challenge")),
    }
    let signed = Value::map([
        ("community_id", b(&cid)),
        ("node_id", b(&app.node_id)),
        ("nonce", b(&nonce)),
        ("scope", Value::Text(scope_text.into())),
    ]);
    if !verify(&key, ctx::AUTH, &cbor::encode(&signed), &sig) {
        return Err(ApiError::unauthorized("bad signature"));
    }
    let expires_at = app.clock.now() + app.config.session_ttl_secs * 1000;
    let s = Session {
        cid,
        scope,
        key,
        mailbox: mailbox_id(&cid, &key),
        expires_at,
    };
    // Check the key is acceptable for the scope right now.
    let token = hex(&random::<32>());
    app.sessions.lock().unwrap().insert(token.clone(), s);
    if let Err(e) = authorize_token(&app, Some(&token), &cid, scope) {
        app.sessions.lock().unwrap().remove(&token);
        return Err(e);
    }
    ok(Value::map([
        ("token", Value::Text(token)),
        ("expires_at", int(expires_at)),
    ]))
}

// ---------------------------------------------------------------------------
// Communities
// ---------------------------------------------------------------------------

async fn create_community(
    State(app): State<Shared>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    provisioning_allowed(&app, &headers)?;
    let v = parse(&body)?;
    let env =
        OpEnvelope::from_value(field(&v, "genesis")?).map_err(|e| ApiError::bad(e.to_string()))?;
    let now = app.clock.now();
    let mut st = app.store.lock().unwrap();
    let tx = st.tx()?;
    let (cid, seq) = sequencer::create(&tx, env, now)?;
    tx.commit()?;
    tracing::info!(cid = %hex(&cid), "community created");
    ok(Value::map([("community_id", b(&cid)), ("seq", int(seq))]))
}

fn entries_field(v: &Value, k: &str) -> Result<Vec<LogEntry>, ApiError> {
    let Value::Array(items) = field(v, k)? else {
        return Err(ApiError::bad(format!("{k} must be an array")));
    };
    items
        .iter()
        .map(|e| {
            LogEntry::decode(&cbor::encode(e)).map_err(|err| ApiError::bad(format!("{k}: {err}")))
        })
        .collect()
}

async fn restore_community(
    State(app): State<Shared>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    provisioning_allowed(&app, &headers)?;
    let v = parse(&body)?;
    let chain = entries_field(&v, "control_chain")?;
    let tail = entries_field(&v, "tail")?;
    let snapshot = v
        .get("snapshot")
        .map(|s| SnapshotEnvelope::from_value(s).map_err(|e| ApiError::bad(e.to_string())))
        .transpose()?;
    let now = app.clock.now();
    let mut st = app.store.lock().unwrap();
    let tx = st.tx()?;
    let (cid, head) = sequencer::restore(&tx, chain, snapshot, tail, now)?;
    tx.commit()?;
    tracing::info!(cid = %hex(&cid), head, "community restored");
    ok(Value::map([
        ("community_id", b(&cid)),
        ("head_seq", int(head)),
    ]))
}

// ---------------------------------------------------------------------------
// Log (§6)
// ---------------------------------------------------------------------------

async fn post_ops(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize(&app, &headers, &cid, Scope::Community)?;
    let v = parse(&body)?;
    let Value::Array(ops) = field(&v, "ops")? else {
        return Err(ApiError::bad("ops must be an array"));
    };
    if ops.is_empty() || ops.len() > app.config.max_batch {
        return Err(ApiError::bad(format!(
            "between 1 and {} ops per batch",
            app.config.max_batch
        )));
    }

    let now = app.clock.now();
    let grace = app.epoch_grace_ms();
    let mut results = Vec::with_capacity(ops.len());
    let head;
    {
        let mut st = app.store.lock().unwrap();
        let tx = st.tx()?;
        for op in ops {
            let decoded = OpEnvelope::decode(&cbor::encode(op));
            let result = match decoded {
                Err(e) => Value::map([
                    ("error", Value::Text("malformed".into())),
                    ("detail", Value::Text(e.to_string())),
                ]),
                Ok(env) if env.cid != cid => Value::map([
                    ("op_id", b(&env.op_id)),
                    ("error", Value::Text("not_hosted".into())),
                ]),
                Ok(env) => {
                    let op_id = env.op_id;
                    match sequencer::submit(&tx, env, now, grace) {
                        Ok(seq) => Value::map([("op_id", b(&op_id)), ("seq", int(seq))]),
                        Err(SeqError::Reject(r)) => Value::map([
                            ("op_id", b(&op_id)),
                            ("error", Value::Text(r.code().into())),
                        ]),
                        Err(SeqError::Db(e)) => return Err(e.into()),
                    }
                }
            };
            results.push(result);
        }
        head = store::community(&tx, &cid)?
            .map(|c| c.head_seq)
            .unwrap_or(0);
        tx.commit()?;
    }
    app.notify(&cid, Notice::Head(head));
    ok(Value::map([
        ("results", Value::Array(results)),
        ("head_seq", int(head)),
    ]))
}

#[derive(Deserialize)]
struct After {
    after: Option<u64>,
    limit: Option<u32>,
}

async fn get_ops(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    Query(q): Query<After>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize(&app, &headers, &cid, Scope::Community)?;
    let after = q.after.unwrap_or(0);
    let limit = q.limit.unwrap_or(500).clamp(1, 1000);
    let st = app.store.lock().unwrap();
    let cm = store::community(st.conn(), &cid)?.ok_or_else(ApiError::not_hosted)?;
    if after < cm.compacted_through {
        let mut e = ApiError::new(
            StatusCode::GONE,
            "gone",
            "compacted; restore from the snapshot",
        );
        e.extra.push(("snapshot_seq", int(cm.compacted_through)));
        return Err(e);
    }
    let rows = store::entries_after(st.conn(), &cid, after, limit)?;
    let entries = rows
        .iter()
        .map(|r| cbor::decode(r).map_err(|_| ApiError::from(rusqlite::Error::InvalidQuery)))
        .collect::<Result<Vec<_>, _>>()?;
    ok(Value::map([
        ("entries", Value::Array(entries)),
        ("head_seq", int(cm.head_seq)),
    ]))
}

/// Every control-plane entry, for devices preparing a restore (§11.3).
async fn get_control(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize(&app, &headers, &cid, Scope::Community)?;
    let st = app.store.lock().unwrap();
    let rows = store::control_entries(st.conn(), &cid)?;
    let entries = rows.iter().filter_map(|r| cbor::decode(r).ok()).collect();
    ok(Value::map([("entries", Value::Array(entries))]))
}

// ---------------------------------------------------------------------------
// Snapshots (§12)
// ---------------------------------------------------------------------------

async fn get_snapshot(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize(&app, &headers, &cid, Scope::Community)?;
    let st = app.store.lock().unwrap();
    let env: Option<Vec<u8>> = st
        .conn()
        .query_row(
            "SELECT env FROM snapshots WHERE cid = ?1 ORDER BY seq DESC LIMIT 1",
            [cid],
            |r| r.get(0),
        )
        .optional()?;
    let env = env.ok_or_else(ApiError::not_found)?;
    Ok(cbor_response(
        StatusCode::OK,
        cbor::decode(&env).map_err(|_| ApiError::from(rusqlite::Error::InvalidQuery))?,
    ))
}

async fn put_snapshot(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    // Admins only: a snapshot lets the node compact the log behind it, so a
    // member holding just the epoch access key must not be able to plant one.
    authorize(&app, &headers, &cid, Scope::Control)?;
    let snap = SnapshotEnvelope::decode(&body).map_err(|e| ApiError::bad(e.to_string()))?;
    if snap.cid != cid {
        return Err(ApiError::bad("snapshot for another community"));
    }
    let now = app.clock.now();
    let mut st = app.store.lock().unwrap();
    let tx = st.tx()?;
    let cm = store::community(&tx, &cid)?.ok_or_else(ApiError::not_hosted)?;
    if snap.seq > cm.head_seq || snap.epoch > cm.epoch {
        return Err(ApiError::bad("snapshot is ahead of the log"));
    }
    // The node can check `head` against its own log: a snapshot must name a real entry.
    let entry = store::entry_at(&tx, &cid, snap.seq)?.ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "gone",
            "entry at snapshot seq is not retained",
        )
    })?;
    let entry =
        LogEntry::decode(&entry).map_err(|_| ApiError::from(rusqlite::Error::InvalidQuery))?;
    if entry.hash() != snap.head {
        return Err(ApiError::bad("snapshot head does not match the log"));
    }
    let eak = store::eak(&tx, &cid, snap.epoch)?.ok_or_else(|| ApiError::bad("unknown epoch"))?;
    if !snap.verify_access(&eak) {
        return Err(ApiError::unauthorized("bad snapshot access signature"));
    }
    let latest: Option<u64> = tx
        .query_row(
            "SELECT MAX(seq) FROM snapshots WHERE cid = ?1",
            [cid],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    if latest.is_some_and(|l| l >= snap.seq) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "stale",
            "a newer snapshot exists",
        ));
    }
    tx.execute(
        "INSERT INTO snapshots (cid, seq, env, stored_at) VALUES (?1, ?2, ?3, ?4)",
        params![cid, snap.seq, snap.encode(), now],
    )?;
    // Keep the latest two.
    tx.execute(
        "DELETE FROM snapshots WHERE cid = ?1 AND seq NOT IN
           (SELECT seq FROM snapshots WHERE cid = ?1 ORDER BY seq DESC LIMIT 2)",
        [cid],
    )?;
    tx.commit()?;
    ok(Value::map([("seq", int(snap.seq))]))
}

// ---------------------------------------------------------------------------
// Mailboxes (§10)
// ---------------------------------------------------------------------------

fn mbx_param(s: &str) -> Result<[u8; 32], ApiError> {
    unhex::<32>(s).ok_or_else(|| ApiError::bad("mailbox id must be 64 hex characters"))
}

async fn post_mailbox(
    State(app): State<Shared>,
    Path((cid, mbx)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    let mbx = mbx_param(&mbx)?;
    authorize(&app, &headers, &cid, Scope::Community)?;
    let v = parse(&body)?;
    let kind = field(&v, "kind")?
        .as_text()
        .filter(|k| !k.is_empty() && k.len() <= 32)
        .ok_or_else(|| ApiError::bad("kind"))?;
    let ct = field(&v, "ct")?
        .as_bytes()
        .ok_or_else(|| ApiError::bad("ct"))?;
    if ct.len() > MAX_MAILBOX_CT {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_large",
            "mailbox item too large",
        ));
    }
    let now = app.clock.now();
    // Key envelopes and removal notices stay until acknowledged (§7.3,
    // §10): a member may be offline for longer than any TTL. Everything
    // else expires.
    let expires_at = if kind == "key_env" || kind == "removed" {
        None
    } else {
        let ttl = v
            .get("ttl_s")
            .and_then(Value::as_uint)
            .unwrap_or(app.config.max_mailbox_ttl_secs);
        Some(now + ttl.min(app.config.max_mailbox_ttl_secs) * 1000)
    };
    let id = {
        let st = app.store.lock().unwrap();
        let count: u32 = st.conn().query_row(
            "SELECT COUNT(*) FROM mailbox WHERE cid = ?1 AND mbx = ?2",
            params![cid, mbx],
            |r| r.get(0),
        )?;
        if count >= app.config.max_mailbox_items {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "mailbox full",
            ));
        }
        st.conn().execute(
            "INSERT INTO mailbox (cid, mbx, kind, ct, posted_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![cid, mbx, kind, ct, now, expires_at],
        )?;
        st.conn().last_insert_rowid() as u64
    };
    app.notify(&cid, Notice::Mailbox(mbx));
    ok(Value::map([("id", int(id))]))
}

fn require_own_mailbox(s: &Session, mbx: &[u8; 32]) -> Result<(), ApiError> {
    if s.mailbox != *mbx {
        return Err(ApiError::unauthorized("not your mailbox"));
    }
    Ok(())
}

async fn get_mailbox(
    State(app): State<Shared>,
    Path((cid, mbx)): Path<(String, String)>,
    Query(q): Query<After>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    let mbx = mbx_param(&mbx)?;
    let s = authorize(&app, &headers, &cid, Scope::Mailbox)?;
    require_own_mailbox(&s, &mbx)?;
    let now = app.clock.now();
    let st = app.store.lock().unwrap();
    let mut q2 = st.conn().prepare_cached(
        "SELECT id, kind, ct, posted_at FROM mailbox
         WHERE cid = ?1 AND mbx = ?2 AND id > ?3 AND (expires_at IS NULL OR expires_at > ?4)
         ORDER BY id LIMIT ?5",
    )?;
    let items = q2
        .query_map(
            params![
                cid,
                mbx,
                q.after.unwrap_or(0),
                now,
                q.limit.unwrap_or(100).clamp(1, 500)
            ],
            |r| {
                Ok(Value::map([
                    ("id", Value::Int(r.get(0)?)),
                    ("kind", Value::Text(r.get(1)?)),
                    ("ct", Value::Bytes(r.get(2)?)),
                    ("posted_at", Value::Int(r.get(3)?)),
                ]))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    ok(Value::map([("items", Value::Array(items))]))
}

async fn delete_mailbox(
    State(app): State<Shared>,
    Path((cid, mbx, id)): Path<(String, String, u64)>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    let mbx = mbx_param(&mbx)?;
    let s = authorize(&app, &headers, &cid, Scope::Mailbox)?;
    require_own_mailbox(&s, &mbx)?;
    let n = app.store.lock().unwrap().conn().execute(
        "DELETE FROM mailbox WHERE cid = ?1 AND mbx = ?2 AND id = ?3",
        params![cid, mbx, id],
    )?;
    if n == 0 {
        return Err(ApiError::not_found());
    }
    ok(Value::Map(Vec::new()))
}

// ---------------------------------------------------------------------------
// Intake, invites, policy (§10.1, §10.3)
// ---------------------------------------------------------------------------

async fn post_intake(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    req: Request,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    let ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip());
    let body = to_bytes(req.into_body(), MAX_INTAKE_CT + 1024)
        .await
        .map_err(|_| ApiError::bad("body too large"))?;
    if !app.rate_ok(
        format!("intake-ip:{}", App::ip_key(ip)),
        app.config.intake_per_ip_per_hour,
    ) || !app.rate_ok(
        format!("intake-c:{}", hex(&cid)),
        app.config.intake_per_community_per_hour,
    ) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "too many join requests",
        ));
    }
    let v = parse(&body)?;
    let enc: [u8; 32] = bytes_field(&v, "enc")?;
    let ct = field(&v, "ct")?
        .as_bytes()
        .ok_or_else(|| ApiError::bad("ct"))?;
    if ct.len() > MAX_INTAKE_CT {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_large",
            "join request too large",
        ));
    }
    let now = app.clock.now();
    let mut st = app.store.lock().unwrap();
    let tx = st.tx()?;
    let cm = store::community(&tx, &cid)?.ok_or_else(ApiError::not_hosted)?;
    match cm.intake_mode.as_str() {
        "open" => {}
        "invite_only" => {
            let secret = v
                .get("invite")
                .and_then(Value::as_bytes)
                .ok_or_else(|| ApiError::unauthorized("invite required"))?;
            let h = hash_ctx(ctx::INVITE, &[secret]);
            let n = tx.execute(
                "UPDATE invites SET uses_left = uses_left - 1
                 WHERE cid = ?1 AND hash = ?2 AND uses_left > 0 AND expires_at > ?3",
                params![cid, h, now],
            )?;
            if n == 0 {
                return Err(ApiError::unauthorized(
                    "invite is invalid, used up or expired",
                ));
            }
        }
        _ => {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "closed",
                "this community is not accepting requests",
            ))
        }
    }
    tx.execute(
        "INSERT INTO intake (cid, enc, ct, at) VALUES (?1, ?2, ?3, ?4)",
        params![cid, enc, ct, now],
    )?;
    let id = tx.last_insert_rowid() as u64;
    tx.commit()?;
    ok(Value::map([("id", int(id))]))
}

async fn get_intake(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    Query(q): Query<After>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize(&app, &headers, &cid, Scope::Control)?;
    let st = app.store.lock().unwrap();
    let mut q2 = st.conn().prepare_cached(
        "SELECT id, enc, ct, at FROM intake WHERE cid = ?1 AND id > ?2 ORDER BY id LIMIT ?3",
    )?;
    let items = q2
        .query_map(
            params![
                cid,
                q.after.unwrap_or(0),
                q.limit.unwrap_or(100).clamp(1, 500)
            ],
            |r| {
                Ok(Value::map([
                    ("id", Value::Int(r.get(0)?)),
                    ("enc", Value::Bytes(r.get(1)?)),
                    ("ct", Value::Bytes(r.get(2)?)),
                    ("at", Value::Int(r.get(3)?)),
                ]))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    ok(Value::map([("items", Value::Array(items))]))
}

async fn delete_intake(
    State(app): State<Shared>,
    Path((cid, id)): Path<(String, u64)>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize(&app, &headers, &cid, Scope::Control)?;
    let n = app.store.lock().unwrap().conn().execute(
        "DELETE FROM intake WHERE cid = ?1 AND id = ?2",
        params![cid, id],
    )?;
    if n == 0 {
        return Err(ApiError::not_found());
    }
    ok(Value::Map(Vec::new()))
}

async fn put_intake_policy(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize(&app, &headers, &cid, Scope::Control)?;
    let v = parse(&body)?;
    let mode = field(&v, "mode")?
        .as_text()
        .ok_or_else(|| ApiError::bad("mode"))?;
    if !matches!(mode, "open" | "invite_only" | "closed") {
        return Err(ApiError::bad("mode must be open, invite_only or closed"));
    }
    let mut st = app.store.lock().unwrap();
    let tx = st.tx()?;
    let mut cm = store::community(&tx, &cid)?.ok_or_else(ApiError::not_hosted)?;
    cm.intake_mode = mode.into();
    store::update_community(&tx, &cm)?;
    tx.commit()?;
    ok(Value::map([("mode", Value::Text(mode.into()))]))
}

async fn post_invite(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize(&app, &headers, &cid, Scope::Control)?;
    let v = parse(&body)?;
    let hash: [u8; 32] = bytes_field(&v, "hash")?;
    let expires_at = uint_field(&v, "expires_at")?;
    let max_uses = uint_field(&v, "max_uses")?.clamp(1, 10_000);
    app.store.lock().unwrap().conn().execute(
        "INSERT OR REPLACE INTO invites (cid, hash, expires_at, uses_left) VALUES (?1, ?2, ?3, ?4)",
        params![cid, hash, expires_at, max_uses],
    )?;
    ok(Value::map([("hash", b(&hash))]))
}

// ---------------------------------------------------------------------------
// Directory entry (§11.2): an opaque, admin-signed blob the node serves.
// ---------------------------------------------------------------------------

async fn get_directory(
    State(app): State<Shared>,
    Path(cid): Path<String>,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    let st = app.store.lock().unwrap();
    let entry: Option<Vec<u8>> = st
        .conn()
        .query_row("SELECT entry FROM directory WHERE cid = ?1", [cid], |r| {
            r.get(0)
        })
        .optional()?;
    let entry = entry.ok_or_else(ApiError::not_found)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/cbor")],
        entry,
    )
        .into_response())
}

async fn put_directory(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize(&app, &headers, &cid, Scope::Control)?;
    if body.len() > MAX_DIRECTORY {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_large",
            "directory entry too large",
        ));
    }
    parse(&body)?; // must be canonical CBOR; signature is checked by clients
    app.store.lock().unwrap().conn().execute(
        "INSERT OR REPLACE INTO directory (cid, entry) VALUES (?1, ?2)",
        params![cid, body.to_vec()],
    )?;
    ok(Value::Map(Vec::new()))
}

// ---------------------------------------------------------------------------
// WebSocket notifications. Data is always fetched over HTTP; the socket only
// says "there is something new", so a dropped socket never loses data.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct StreamQuery {
    token: String,
    mailbox_token: Option<String>,
}

async fn stream(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    Query(q): Query<StreamQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let cid = cid_param(&cid)?;
    authorize_token(&app, Some(&q.token), &cid, Scope::Community)?;
    let mailbox = match &q.mailbox_token {
        Some(t) => Some(authorize_token(&app, Some(t), &cid, Scope::Mailbox)?.mailbox),
        None => None,
    };
    let head = store::community(app.store.lock().unwrap().conn(), &cid)?
        .map(|c| c.head_seq)
        .unwrap_or(0);
    let rx = app.subscribe(&cid);
    Ok(ws.on_upgrade(move |socket| pump(socket, rx, head, mailbox)))
}

fn notice_bytes(n: &Notice) -> Vec<u8> {
    cbor::encode(&match n {
        Notice::Head(seq) => Value::map([("head_seq", int(*seq))]),
        Notice::Mailbox(m) => Value::map([("mailbox", b(m))]),
    })
}

async fn pump(
    mut socket: WebSocket,
    mut rx: tokio::sync::broadcast::Receiver<Notice>,
    head: u64,
    mailbox: Option<[u8; 32]>,
) {
    if socket
        .send(Message::Binary(notice_bytes(&Notice::Head(head)).into()))
        .await
        .is_err()
    {
        return;
    }
    loop {
        tokio::select! {
            n = rx.recv() => match n {
                Ok(n @ Notice::Head(_)) => {
                    if socket.send(Message::Binary(notice_bytes(&n).into())).await.is_err() { return; }
                }
                Ok(n @ Notice::Mailbox(m)) if Some(m) == mailbox => {
                    if socket.send(Message::Binary(notice_bytes(&n).into())).await.is_err() { return; }
                }
                Ok(_) => {}
                // Lagged: tell the client to re-sync rather than drop silently.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if socket.send(Message::Binary(cbor::encode(&Value::map([("resync", Value::Bool(true))])).into())).await.is_err() { return; }
                }
                Err(_) => return,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                _ => {}
            },
        }
    }
}

/// Body size limit applied to the whole router.
pub fn body_limit() -> axum::extract::DefaultBodyLimit {
    axum::extract::DefaultBodyLimit::max(MAX_BODY)
}
