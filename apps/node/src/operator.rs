//! Operator API for managed hosting (docs/managed-hosting.md): usage,
//! suspension, deletion, export and Prometheus metrics.
//!
//! It is served on its own listener (`operator_listen`), never next to the
//! public API, and every request needs `Authorization: Bearer
//! <operator_token>`. It exposes nothing the operator could not already read
//! from the database: sizes, counts, timestamps and ciphertext. There is no
//! endpoint that reveals or alters community content, members or keys.

use std::fmt::Write as _;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use vv_crypto::cbor;

use crate::app::{hex, same_secret, unhex, App};
use crate::sequencer;
use crate::store::{self, Cid};

type Shared = Arc<App>;

pub fn router(app: Shared) -> Router {
    Router::new()
        .route("/operator/v1/communities", get(list))
        .route("/operator/v1/communities/{cid}", delete(remove))
        .route("/operator/v1/communities/{cid}/suspend", post(suspend))
        .route("/operator/v1/communities/{cid}/resume", post(resume))
        .route("/operator/v1/communities/{cid}/export", get(export))
        .route("/operator/v1/tenants", get(tenants))
        .route("/operator/v1/metrics", get(metrics))
        .with_state(app)
}

pub struct OpError(StatusCode, &'static str, String);

impl IntoResponse for OpError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "code": self.1, "detail": self.2 }))).into_response()
    }
}

impl From<rusqlite::Error> for OpError {
    fn from(e: rusqlite::Error) -> Self {
        tracing::error!(error = %e, "database error");
        OpError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "storage error".into(),
        )
    }
}

fn authorize(app: &App, headers: &HeaderMap) -> Result<(), OpError> {
    let expected = app.config.operator_token.as_deref().unwrap_or("");
    let got = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if expected.is_empty() || !same_secret(got.as_bytes(), expected.as_bytes()) {
        return Err(OpError(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "operator token required".into(),
        ));
    }
    Ok(())
}

fn cid_param(s: &str) -> Result<Cid, OpError> {
    unhex::<32>(s).ok_or(OpError(
        StatusCode::BAD_REQUEST,
        "malformed",
        "community id must be 64 hex characters".into(),
    ))
}

fn not_hosted() -> OpError {
    OpError(
        StatusCode::NOT_FOUND,
        "not_hosted",
        "community not hosted here".into(),
    )
}

/// Per-community usage. Only what the node already stores in the clear.
pub struct Usage {
    pub cid: Cid,
    pub tenant: Option<String>,
    pub created_at: u64,
    pub head_seq: u64,
    pub epoch: u32,
    pub log_bytes: u64,
    pub blob_bytes: u64,
    pub snapshot_bytes: u64,
    pub mailbox_items: u64,
    pub mailbox_bytes: u64,
    pub intake_items: u64,
    pub suspended: bool,
    pub moved_to: Vec<String>,
    pub intake_mode: String,
}

pub fn usage(c: &rusqlite::Connection) -> rusqlite::Result<Vec<Usage>> {
    let mut st = c.prepare(
        "SELECT c.cid, c.tenant, c.created_at, c.head_seq, c.epoch, c.log_bytes, c.suspended,
                c.moved_to, c.intake_mode, c.blob_bytes,
                (SELECT COALESCE(SUM(length(env)), 0) FROM snapshots s WHERE s.cid = c.cid),
                (SELECT COUNT(*) FROM mailbox m WHERE m.cid = c.cid),
                (SELECT COALESCE(SUM(length(ct)), 0) FROM mailbox m WHERE m.cid = c.cid),
                (SELECT COUNT(*) FROM intake i WHERE i.cid = c.cid)
         FROM communities c ORDER BY c.created_at, c.cid",
    )?;
    let rows = st.query_map([], |r| {
        let cid: Vec<u8> = r.get(0)?;
        Ok(Usage {
            cid: cid.try_into().map_err(|_| rusqlite::Error::InvalidQuery)?,
            tenant: r.get(1)?,
            created_at: r.get(2)?,
            head_seq: r.get(3)?,
            epoch: r.get(4)?,
            log_bytes: r.get(5)?,
            suspended: r.get(6)?,
            moved_to: store::decode_urls(r.get(7)?),
            intake_mode: r.get(8)?,
            blob_bytes: r.get(9)?,
            snapshot_bytes: r.get(10)?,
            mailbox_items: r.get(11)?,
            mailbox_bytes: r.get(12)?,
            intake_items: r.get(13)?,
        })
    })?;
    rows.collect()
}

async fn list(State(app): State<Shared>, headers: HeaderMap) -> Result<Response, OpError> {
    authorize(&app, &headers)?;
    let rows = usage(app.store.lock().unwrap().conn())?;
    let items: Vec<_> = rows
        .iter()
        .map(|u| {
            json!({
                "community_id": hex(&u.cid),
                "tenant": u.tenant,
                "created_at": u.created_at,
                "head_seq": u.head_seq,
                "epoch": u.epoch,
                "log_bytes": u.log_bytes,
                "blob_bytes": u.blob_bytes,
                "snapshot_bytes": u.snapshot_bytes,
                "mailbox_items": u.mailbox_items,
                "mailbox_bytes": u.mailbox_bytes,
                "intake_items": u.intake_items,
                "suspended": u.suspended,
                "moved_to": u.moved_to,
                "intake_mode": u.intake_mode,
            })
        })
        .collect();
    Ok(Json(json!({ "communities": items })).into_response())
}

async fn tenants(State(app): State<Shared>, headers: HeaderMap) -> Result<Response, OpError> {
    authorize(&app, &headers)?;
    let rows = usage(app.store.lock().unwrap().conn())?;
    let items: Vec<_> = app
        .config
        .tenants
        .iter()
        .map(|t| {
            let mine = rows.iter().filter(|u| u.tenant.as_deref() == Some(&t.name));
            let (count, bytes, blob_bytes) = mine.fold((0u64, 0u64, 0u64), |(n, b, bb), u| {
                (n + 1, b + u.log_bytes, bb + u.blob_bytes)
            });
            let max_blob_bytes_total = app.config.max_blob_bytes_total(Some(&t.name));
            json!({
                "name": t.name,
                "communities": count,
                "max_communities": t.max_communities,
                "log_bytes": bytes,
                "max_log_bytes_per_community": t.max_log_bytes,
                "blob_bytes": blob_bytes,
                "max_blob_bytes_total_per_community": max_blob_bytes_total,
            })
        })
        .collect();
    Ok(Json(json!({ "tenants": items })).into_response())
}

fn set_suspended(app: &App, cid: &Cid, suspended: bool) -> Result<Response, OpError> {
    let mut st = app.store.lock().unwrap();
    let tx = st.tx()?;
    let mut cm = store::community(&tx, cid)?.ok_or_else(not_hosted)?;
    cm.suspended = suspended;
    store::update_community(&tx, &cm)?;
    tx.commit()?;
    tracing::info!(cid = %hex(cid), suspended, "operator changed suspension");
    Ok(Json(json!({ "community_id": hex(cid), "suspended": suspended })).into_response())
}

async fn suspend(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
) -> Result<Response, OpError> {
    authorize(&app, &headers)?;
    set_suspended(&app, &cid_param(&cid)?, true)
}

async fn resume(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
) -> Result<Response, OpError> {
    authorize(&app, &headers)?;
    set_suspended(&app, &cid_param(&cid)?, false)
}

#[derive(Deserialize)]
struct Confirm {
    confirm: Option<String>,
}

/// Deletes every row of a community. Needs `?confirm=<community id>`.
async fn remove(
    State(app): State<Shared>,
    Path(cid_text): Path<String>,
    Query(q): Query<Confirm>,
    headers: HeaderMap,
) -> Result<Response, OpError> {
    authorize(&app, &headers)?;
    let cid = cid_param(&cid_text)?;
    if q.confirm.as_deref() != Some(cid_text.as_str()) {
        return Err(OpError(
            StatusCode::BAD_REQUEST,
            "confirm",
            "repeat the community id in ?confirm= to delete it".into(),
        ));
    }
    let mut st = app.store.lock().unwrap();
    let tx = st.tx()?;
    if !store::delete_community(&tx, &cid)? {
        return Err(not_hosted());
    }
    tx.commit()?;
    drop(st);
    app.sessions.lock().unwrap().retain(|_, s| s.cid != cid);
    tracing::warn!(cid = %hex(&cid), "operator deleted community");
    Ok(Json(json!({ "deleted": hex(&cid) })).into_response())
}

/// The same restore payload admins get from `GET /v1/c/{cid}/export`, as
/// CBOR. Lets an operator hand a community back when closing an account.
async fn export(
    State(app): State<Shared>,
    Path(cid): Path<String>,
    headers: HeaderMap,
) -> Result<Response, OpError> {
    authorize(&app, &headers)?;
    let cid = cid_param(&cid)?;
    let payload =
        sequencer::export(app.store.lock().unwrap().conn(), &cid)?.ok_or_else(not_hosted)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/cbor")],
        cbor::encode(&payload),
    )
        .into_response())
}

fn label(v: &str) -> String {
    v.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

/// Prometheus text format. Aggregated per tenant, never per community, so
/// metrics shipped to a monitoring service do not list communities.
pub fn render_metrics(app: &App) -> rusqlite::Result<String> {
    let rows = usage(app.store.lock().unwrap().conn())?;
    let mut tenants: Vec<String> = rows
        .iter()
        .map(|u| u.tenant.clone().unwrap_or_default())
        .collect();
    tenants.sort();
    tenants.dedup();

    let mut out = String::new();
    let mut gauge = |name: &str, help: &str, f: &dyn Fn(&Usage) -> u64| {
        let _ = writeln!(out, "# HELP {name} {help}\n# TYPE {name} gauge");
        for t in &tenants {
            let sum: u64 = rows
                .iter()
                .filter(|u| u.tenant.as_deref().unwrap_or("") == t)
                .map(f)
                .sum();
            let _ = writeln!(out, "{name}{{tenant=\"{}\"}} {sum}", label(t));
        }
    };
    gauge("vv_communities", "Communities hosted.", &|_| 1);
    gauge(
        "vv_communities_suspended",
        "Communities suspended by the operator.",
        &|u| u.suspended as u64,
    );
    gauge(
        "vv_communities_moved",
        "Communities that moved to another node.",
        &|u| (!u.moved_to.is_empty()) as u64,
    );
    gauge("vv_log_bytes", "Bytes of stored log entries.", &|u| {
        u.log_bytes
    });
    gauge(
        "vv_blob_bytes",
        "Bytes of stored blobs (file attachments).",
        &|u| u.blob_bytes,
    );
    gauge("vv_snapshot_bytes", "Bytes of stored snapshots.", &|u| {
        u.snapshot_bytes
    });
    gauge("vv_mailbox_items", "Undelivered mailbox items.", &|u| {
        u.mailbox_items
    });
    gauge(
        "vv_mailbox_bytes",
        "Bytes of undelivered mailbox items.",
        &|u| u.mailbox_bytes,
    );
    gauge(
        "vv_intake_items",
        "Join requests waiting for an admin.",
        &|u| u.intake_items,
    );
    let sessions = app.sessions.lock().unwrap().len();
    let _ = writeln!(
        out,
        "# HELP vv_sessions Live auth sessions.\n# TYPE vv_sessions gauge\nvv_sessions {sessions}"
    );
    let _ = writeln!(
        out,
        "# HELP vv_schema_version Database schema version.\n# TYPE vv_schema_version gauge\nvv_schema_version {}",
        store::SCHEMA_VERSION
    );
    Ok(out)
}

async fn metrics(State(app): State<Shared>, headers: HeaderMap) -> Result<Response, OpError> {
    authorize(&app, &headers)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        render_metrics(&app)?,
    )
        .into_response())
}
