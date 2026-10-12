//! Managed hosting (Phase 10): moving a community between nodes, tenants and
//! quotas, operator suspension, the operator API and schema upgrades.

mod common;

use axum::http::StatusCode;
use common::*;
use community_node::app::Tenant;
use community_node::Config;
use vv_crypto::cbor::{self, Value};
use vv_crypto::envelope::LogEntry;
use vv_crypto::keys::mailbox_id;
use vv_crypto::primitives::public_key;

const OPERATOR: &str = "operator-token-0123456789";

fn entries(v: &Value) -> Vec<LogEntry> {
    let Value::Array(items) = v.get("entries").unwrap() else {
        panic!("entries")
    };
    items
        .iter()
        .map(|e| LogEntry::decode(&cbor::encode(e)).unwrap())
        .collect()
}

fn code(v: &Value) -> &str {
    v.get("code").and_then(Value::as_text).unwrap_or("")
}

async fn member_token(app: &std::sync::Arc<community_node::App>, f: &Fixture) -> String {
    login(app, &f.cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap()
}

async fn post_mailbox(
    app: &std::sync::Arc<community_node::App>,
    f: &Fixture,
    t: &str,
) -> (StatusCode, Value) {
    let mbx = mailbox_id(&f.cid, &public_key(&[77; 32]));
    call(
        app,
        "POST",
        &format!("/v1/c/{}/mailbox/{}", hex(&f.cid), hex(&mbx)),
        Some(t),
        Some(Value::map([
            ("kind", Value::Text("key_env".into())),
            ("ct", b(&[1, 2, 3])),
        ])),
    )
    .await
}

#[tokio::test]
async fn migrate_freezes_writes_and_the_export_restores_elsewhere() {
    let a = node();
    let mut f = Fixture::new(40);
    create(&a, &mut f).await;
    let cid = f.cid;
    let t = member_token(&a, &f).await;
    let ops: Vec<_> = (0..3).map(|_| f.data([50; 32])).collect();
    submit(&a, &cid, &t, ops).await;

    // Only admins (or the CRK) can move a community, and only to http(s) URLs.
    let m = f.migrate([50; 32], &["https://b.example"]);
    assert_eq!(
        first_result(&submit(&a, &cid, &t, vec![m]).await.1),
        Err("unauthorized".into())
    );
    // (Sealing refuses bad URLs, so rewrite one on the wire.)
    let good = cbor::encode(&f.migrate(f.admin, &["https://b.example"]).to_value());
    let at = good
        .windows(17)
        .position(|w| w == b"https://b.example")
        .unwrap();
    let mut bad = good.clone();
    bad[at..at + 17].copy_from_slice(b"ftp://bbb.example");
    let (_, v) = call(
        &a,
        "POST",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&t),
        Some(Value::map([(
            "ops",
            Value::Array(vec![cbor::decode(&bad).unwrap()]),
        )])),
    )
    .await;
    assert_eq!(first_result(&v), Err("malformed".into()));
    let m = f.migrate(f.admin, &["https://b.example"]);
    let migrate_seq = first_result(&submit(&a, &cid, &t, vec![m]).await.1).unwrap();

    // Writes now answer with the new location; nothing more lands here.
    let (s, v) = submit(&a, &cid, &t, vec![f.data([50; 32])]).await;
    assert_eq!((s, code(&v)), (StatusCode::CONFLICT, "moved"));
    assert_eq!(
        v.get("nodes"),
        Some(&Value::Array(vec![Value::Text("https://b.example".into())]))
    );
    let (s, v) = post_mailbox(&a, &f, &t).await;
    assert_eq!((s, code(&v)), (StatusCode::CONFLICT, "moved"));
    let (s, v) = call(
        &a,
        "POST",
        &format!("/v1/c/{}/intake", hex(&cid)),
        None,
        Some(Value::map([("enc", b(&[1; 32])), ("ct", b(&[2; 8]))])),
    )
    .await;
    assert_eq!((s, code(&v)), (StatusCode::CONFLICT, "moved"));

    // Reads keep working, so members find the migrate entry and follow it.
    let (s, v) = call(
        &a,
        "GET",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let log = entries(&v);
    assert_eq!(log.last().unwrap().seq, migrate_seq);

    // The admin export is a ready restore body; a fresh node accepts it.
    let admin = login(&a, &cid, &f.admin.clone(), "control").await.unwrap();
    let (s, export) = call(
        &a,
        "GET",
        &format!("/v1/c/{}/export", hex(&cid)),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{export:?}");
    let (s, _) = call(
        &a,
        "GET",
        &format!("/v1/c/{}/export", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "members cannot export");

    let b_node = node();
    let (s, v) = call_raw(
        &b_node,
        "POST",
        "/v1/communities/restore",
        None,
        Some(cbor::encode(&export)),
        &[("x-vv-provision-token", TOKEN)],
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v.get("head_seq").unwrap().as_uint(), Some(migrate_seq));

    // On the new node the community is not "moved": it lives there now.
    let t2 = member_token(&b_node, &f).await;
    let (_, v) = call(
        &b_node,
        "GET",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&t2),
        None,
    )
    .await;
    assert_eq!(entries(&v), log);
    assert_eq!(
        first_result(&submit(&b_node, &cid, &t2, vec![f.data([50; 32])]).await.1),
        Ok(migrate_seq + 1)
    );
    assert_eq!(post_mailbox(&b_node, &f, &t2).await.0, StatusCode::OK);

    // Back on A, an admin can cancel the move with an empty node list.
    let cancel = f.migrate(f.admin, &[]);
    assert!(first_result(&submit(&a, &cid, &t, vec![cancel]).await.1).is_ok());
    assert!(first_result(&submit(&a, &cid, &t, vec![f.data([50; 32])]).await.1).is_ok());
}

#[tokio::test]
async fn export_without_a_snapshot() {
    // Exports with snapshots are covered end to end in packages/sync, where
    // devices seal them. Without one, the tail starts after genesis.
    let a = node();
    let mut f = Fixture::new(41);
    create(&a, &mut f).await;
    let admin = login(&a, &f.cid, &f.admin.clone(), "control")
        .await
        .unwrap();
    let (_, export) = call(
        &a,
        "GET",
        &format!("/v1/c/{}/export", hex(&f.cid)),
        Some(&admin),
        None,
    )
    .await;
    assert!(export.get("snapshot").is_none());
    assert_eq!(export.get("tail"), Some(&Value::Array(vec![])));
    assert_eq!(
        export.get("intake_mode").and_then(Value::as_text),
        Some("open")
    );
}

fn tenant_token_hash(token: &str) -> String {
    use sha2::Digest;
    hex(&sha2::Sha256::digest(token.as_bytes()))
}

fn managed_config(max_communities: Option<u64>, max_log_bytes: Option<u64>) -> Config {
    Config {
        provisioning_token: Some(TOKEN.into()),
        operator_token: Some(OPERATOR.into()),
        tenants: vec![Tenant {
            name: "acme".into(),
            token_sha256: tenant_token_hash("acme-secret"),
            max_communities,
            max_log_bytes,
            max_blob_bytes_total: None,
        }],
        ..Config::default()
    }
}

async fn create_as(
    app: &std::sync::Arc<community_node::App>,
    f: &mut Fixture,
    token: &str,
) -> (StatusCode, Value) {
    let g = f.genesis();
    call_raw(
        app,
        "POST",
        "/v1/communities",
        None,
        Some(cbor::encode(&Value::map([("genesis", g.to_value())]))),
        &[("x-vv-provision-token", token)],
    )
    .await
}

#[tokio::test]
async fn tenants_provision_with_their_own_token_within_limits() {
    let app = node_with(managed_config(Some(1), Some(2_000)));
    let mut f = Fixture::new(42);
    let (s, v) = create_as(&app, &mut f, "wrong").await;
    assert_eq!((s, code(&v)), (StatusCode::FORBIDDEN, "forbidden"));
    let (s, _) = create_as(&app, &mut f, "acme-secret").await;
    assert_eq!(s, StatusCode::OK);
    let mut g = Fixture::new(43);
    let (s, v) = create_as(&app, &mut g, "acme-secret").await;
    assert_eq!(
        (s, code(&v)),
        (StatusCode::INSUFFICIENT_STORAGE, "quota_exceeded")
    );
    // The node's own token is not bound by tenant limits.
    assert_eq!(create_as(&app, &mut g, TOKEN).await.0, StatusCode::OK);

    // The log quota stops data ops, but a community can always leave.
    let t = member_token(&app, &f).await;
    let mut last = Ok(0);
    for _ in 0..20 {
        last = first_result(
            &submit(&app, &f.cid.clone(), &t, vec![f.data([50; 32])])
                .await
                .1,
        );
        if last.is_err() {
            break;
        }
    }
    assert_eq!(last, Err("quota_exceeded".into()));
    let m = f.migrate(f.admin, &["https://self-hosted.example"]);
    assert!(first_result(&submit(&app, &f.cid, &t, vec![m]).await.1).is_ok());

    let (s, body) = operator(&app, "GET", "/operator/v1/tenants", Some(OPERATOR)).await;
    assert_eq!(s, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["tenants"][0]["name"], "acme");
    assert_eq!(v["tenants"][0]["communities"], 1);
    assert!(v["tenants"][0]["log_bytes"].as_u64().unwrap() > 1_500);
}

#[tokio::test]
async fn suspension_blocks_writes_but_never_reads_export_or_leaving() {
    let app = node_with(managed_config(None, None));
    let mut f = Fixture::new(44);
    create(&app, &mut f).await;
    let cid = hex(&f.cid);
    let t = member_token(&app, &f).await;

    let (s, _) = operator(
        &app,
        "POST",
        &format!("/operator/v1/communities/{cid}/suspend"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = operator(
        &app,
        "POST",
        &format!("/operator/v1/communities/{cid}/suspend"),
        Some(OPERATOR),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, v) = submit(&app, &f.cid.clone(), &t, vec![f.data([50; 32])]).await;
    assert_eq!((s, code(&v)), (StatusCode::FORBIDDEN, "suspended"));
    assert_eq!(post_mailbox(&app, &f, &t).await.0, StatusCode::FORBIDDEN);
    let (s, _) = call(&app, "GET", &format!("/v1/c/{cid}/ops"), Some(&t), None).await;
    assert_eq!(s, StatusCode::OK);
    let admin = login(&app, &f.cid, &f.admin.clone(), "control")
        .await
        .unwrap();
    let (s, _) = call(
        &app,
        "GET",
        &format!("/v1/c/{cid}/export"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, body) = operator(
        &app,
        "GET",
        &format!("/operator/v1/communities/{cid}/export"),
        Some(OPERATOR),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(cbor::decode(&body).unwrap().get("control_chain").is_some());

    let (s, _) = operator(
        &app,
        "POST",
        &format!("/operator/v1/communities/{cid}/resume"),
        Some(OPERATOR),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(first_result(
        &submit(&app, &f.cid.clone(), &t, vec![f.data([50; 32])])
            .await
            .1
    )
    .is_ok());

    // Suspended again: a migrate still goes through.
    operator(
        &app,
        "POST",
        &format!("/operator/v1/communities/{cid}/suspend"),
        Some(OPERATOR),
    )
    .await;
    let m = f.migrate(f.admin, &["https://elsewhere.example"]);
    assert!(first_result(&submit(&app, &f.cid, &t, vec![m]).await.1).is_ok());
}

#[tokio::test]
async fn operator_lists_usage_serves_metrics_and_deletes_with_confirmation() {
    let app = node_with(managed_config(None, None));
    let mut f = Fixture::new(45);
    create_as(&app, &mut f, "acme-secret").await;
    let cid = hex(&f.cid);
    let t = member_token(&app, &f).await;
    submit(&app, &f.cid.clone(), &t, vec![f.data([50; 32])]).await;

    let (s, body) = operator(&app, "GET", "/operator/v1/communities", Some("nope")).await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "{}",
        String::from_utf8_lossy(&body)
    );
    let (s, body) = operator(&app, "GET", "/operator/v1/communities", Some(OPERATOR)).await;
    assert_eq!(s, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let c = &v["communities"][0];
    assert_eq!(c["community_id"], cid.as_str());
    assert_eq!(c["tenant"], "acme");
    assert_eq!(c["head_seq"], 2);
    assert!(c["log_bytes"].as_u64().unwrap() > 0);
    assert_eq!(c["suspended"], false);

    let (s, body) = operator(&app, "GET", "/operator/v1/metrics", Some(OPERATOR)).await;
    assert_eq!(s, StatusCode::OK);
    let text = String::from_utf8(body).unwrap();
    assert!(text.contains("vv_communities{tenant=\"acme\"} 1"), "{text}");
    assert!(text.contains("vv_schema_version "), "{text}");
    assert!(!text.contains(&cid), "metrics never name communities");

    let uri = format!("/operator/v1/communities/{cid}");
    assert_eq!(
        operator(&app, "DELETE", &uri, Some(OPERATOR)).await.0,
        StatusCode::BAD_REQUEST
    );
    let (s, _) = operator(
        &app,
        "DELETE",
        &format!("{uri}?confirm={cid}"),
        Some(OPERATOR),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = call(&app, "GET", &format!("/v1/c/{cid}/ops"), Some(&t), None).await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "sessions die with the community"
    );
    assert!(
        login(&app, &f.cid, &f.epoch().eak_seed.clone(), "community")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn the_operator_api_adds_rotates_and_revokes_tenants_without_a_restart() {
    let app = node_with(managed_config(None, None));
    let add = |name: &str, max: u64| serde_json::json!({ "name": name, "max_communities": max, "max_log_bytes": 2_000 });
    let (s, _) = operator_json(&app, "POST", "/operator/v1/tenants", None, add("ana", 1)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, v) = operator_json(
        &app,
        "POST",
        "/operator/v1/tenants",
        Some(OPERATOR),
        add("ana", 1),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let token = v["token"].as_str().unwrap().to_owned();
    assert_eq!(token.len(), 64);
    // Names are unique across the config file and the API.
    for name in ["ana", "acme"] {
        let (s, v) = operator_json(
            &app,
            "POST",
            "/operator/v1/tenants",
            Some(OPERATOR),
            add(name, 1),
        )
        .await;
        assert_eq!(
            (s, v["code"].as_str()),
            (StatusCode::CONFLICT, Some("exists"))
        );
    }
    let (s, _) = operator_json(
        &app,
        "POST",
        "/operator/v1/tenants",
        Some(OPERATOR),
        add("", 1),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // The new token provisions at once, within the tenant's limits.
    let mut f = Fixture::new(60);
    assert_eq!(create_as(&app, &mut f, &token).await.0, StatusCode::OK);
    let mut g = Fixture::new(61);
    let (s, v) = create_as(&app, &mut g, &token).await;
    assert_eq!(
        (s, code(&v)),
        (StatusCode::INSUFFICIENT_STORAGE, "quota_exceeded")
    );
    let t = member_token(&app, &f).await;
    let mut last = Ok(0);
    for _ in 0..20 {
        last = first_result(
            &submit(&app, &f.cid.clone(), &t, vec![f.data([50; 32])])
                .await
                .1,
        );
        if last.is_err() {
            break;
        }
    }
    assert_eq!(last, Err("quota_exceeded".into()));

    // Revoked: the token stops provisioning; the community keeps working
    // (under the same limits) and can always leave.
    let (s, _) = operator(&app, "DELETE", "/operator/v1/tenants/ana", Some(OPERATOR)).await;
    assert_eq!(s, StatusCode::OK);
    let mut h = Fixture::new(62);
    let (s, v) = create_as(&app, &mut h, &token).await;
    assert_eq!((s, code(&v)), (StatusCode::FORBIDDEN, "forbidden"));
    let m = f.migrate(f.admin, &["https://self-hosted.example"]);
    assert!(first_result(&submit(&app, &f.cid, &t, vec![m]).await.1).is_ok());

    // A new token replaces the old one and lifts the revocation.
    let (s, body) = operator(
        &app,
        "POST",
        "/operator/v1/tenants/ana/token",
        Some(OPERATOR),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let fresh: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let fresh = fresh["token"].as_str().unwrap();
    assert_ne!(fresh, token);
    assert_eq!(
        create_as(&app, &mut h, &token).await.0,
        StatusCode::FORBIDDEN
    );
    let (s, v) = create_as(&app, &mut h, fresh).await;
    assert_eq!(
        (s, code(&v)),
        (StatusCode::INSUFFICIENT_STORAGE, "quota_exceeded")
    );

    // Config tenants are changed in the config file, not here.
    let (s, _) = operator(&app, "DELETE", "/operator/v1/tenants/acme", Some(OPERATOR)).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = operator(
        &app,
        "DELETE",
        "/operator/v1/tenants/nobody",
        Some(OPERATOR),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let (s, body) = operator(&app, "GET", "/operator/v1/tenants", Some(OPERATOR)).await;
    assert_eq!(s, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["tenants"][0]["source"], "config");
    assert_eq!(v["tenants"][1]["name"], "ana");
    assert_eq!(v["tenants"][1]["source"], "operator");
    assert_eq!(v["tenants"][1]["communities"], 1);
    assert!(v["tenants"][1]["revoked_at"].is_null());
}

#[tokio::test]
async fn a_node_with_only_api_tenants_accepts_their_tokens() {
    let app = node_with(Config {
        operator_token: Some(OPERATOR.into()),
        ..Config::default()
    });
    let mut f = Fixture::new(63);
    let (s, v) = create_as(&app, &mut f, "anything").await;
    assert_eq!((s, code(&v)), (StatusCode::FORBIDDEN, "forbidden"));
    let (_, v) = operator_json(
        &app,
        "POST",
        "/operator/v1/tenants",
        Some(OPERATOR),
        serde_json::json!({ "name": "solo" }),
    )
    .await;
    let token = v["token"].as_str().unwrap();
    assert_eq!(create_as(&app, &mut f, token).await.0, StatusCode::OK);
}

#[test]
fn config_validation() {
    let mut c = managed_config(None, None);
    assert!(c.validate().is_ok());
    c.operator_listen = Some("127.0.0.1:9787".into());
    c.operator_token = Some("short".into());
    assert!(c.validate().is_err());
    c.operator_token = Some(OPERATOR.into());
    assert!(c.validate().is_ok());
    c.tenants[0].token_sha256 = "not-hex".into();
    assert!(c.validate().is_err());
}

#[test]
fn a_v0_database_is_upgraded_in_place() {
    let dir = std::env::temp_dir().join(format!("vv-node-schema-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("node.sqlite");
    {
        // The Phase 9 schema, as released.
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch(
            "CREATE TABLE communities (cid BLOB PRIMARY KEY, crk BLOB NOT NULL, epoch INTEGER NOT NULL,
               rotated_at INTEGER NOT NULL, admin_set BLOB NOT NULL, head_seq INTEGER NOT NULL,
               head_hash BLOB NOT NULL, head_at INTEGER NOT NULL, compacted_through INTEGER NOT NULL DEFAULT 0,
               intake_mode TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL);
             CREATE TABLE entries (cid BLOB NOT NULL, seq INTEGER NOT NULL, plane TEXT NOT NULL,
               entry BLOB NOT NULL, PRIMARY KEY (cid, seq));
             INSERT INTO communities VALUES (x'01', x'02', 0, 0, x'80', 2, x'03', 0, 0, 'open', 0);
             INSERT INTO entries VALUES (x'01', 1, 'c', zeroblob(100)), (x'01', 2, 'd', zeroblob(50));",
        )
        .unwrap();
    }
    let store = community_node::store::Store::open(&path).unwrap();
    let version: usize = store
        .conn()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, community_node::store::SCHEMA_VERSION);
    let (bytes, suspended): (u64, bool) = store
        .conn()
        .query_row("SELECT log_bytes, suspended FROM communities", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!((bytes, suspended), (150, false));
    drop(store);
    // Opening again is a no-op; a newer schema than the binary is refused.
    community_node::store::Store::open(&path).unwrap();
    rusqlite::Connection::open(&path)
        .unwrap()
        .pragma_update(None, "user_version", 99)
        .unwrap();
    assert!(community_node::store::Store::open(&path).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}
