//! Encrypted blobs (file attachments, protocol.md §15): upload and
//! download, content addressing, limits and quotas, the `moderate` listing
//! and deletion, community states, and what happens on purge and restore.

mod common;

use std::sync::Arc;

use axum::http::StatusCode;
use common::*;
use community_node::app::Tenant;
use community_node::{App, Config};
use vv_crypto::cbor::{self, Value};
use vv_crypto::envelope::OpEnvelope;
use vv_crypto::primitives::public_key;

const OPERATOR: &str = "operator-token-0123456789";

fn code(v: &Value) -> &str {
    v.get("code").and_then(Value::as_text).unwrap_or("")
}

fn blob_id(body: &[u8]) -> [u8; 32] {
    use sha2::Digest;
    let mut id = [0u8; 32];
    id.copy_from_slice(&sha2::Sha256::digest(body));
    id
}

fn blob_uri(cid: &[u8; 32], id: &[u8; 32]) -> String {
    format!("/v1/c/{}/blobs/{}", hex(cid), hex(id))
}

async fn member_token(app: &Arc<App>, f: &Fixture) -> String {
    login(app, &f.cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap()
}

/// `PUT /c/{cid}/blobs/{sha256(body)}`.
async fn put(app: &Arc<App>, cid: &[u8; 32], token: &str, body: &[u8]) -> (StatusCode, Value) {
    call_raw(
        app,
        "PUT",
        &blob_uri(cid, &blob_id(body)),
        Some(token),
        Some(body.to_vec()),
        &[("content-type", "application/octet-stream")],
    )
    .await
}

async fn get(
    app: &Arc<App>,
    cid: &[u8; 32],
    token: &str,
    id: &[u8; 32],
) -> (StatusCode, Option<String>, Vec<u8>) {
    call_bytes(app, "GET", &blob_uri(cid, id), Some(token), None, &[]).await
}

async fn list(app: &Arc<App>, cid: &[u8; 32], token: &str) -> (StatusCode, Value) {
    call(
        app,
        "GET",
        &format!("/v1/c/{}/blobs", hex(cid)),
        Some(token),
        None,
    )
    .await
}

async fn delete(app: &Arc<App>, cid: &[u8; 32], token: &str, id: &[u8; 32]) -> (StatusCode, Value) {
    call(app, "DELETE", &blob_uri(cid, id), Some(token), None).await
}

/// The listing as `(blob_id, size, at)` triples plus `total_bytes`.
fn listed(v: &Value) -> (Vec<(Vec<u8>, u64, u64)>, u64) {
    let Value::Array(items) = v.get("blobs").unwrap() else {
        panic!("blobs")
    };
    let rows = items
        .iter()
        .map(|i| {
            (
                i.get("blob_id").unwrap().as_bytes().unwrap().to_vec(),
                i.get("size").unwrap().as_uint().unwrap(),
                i.get("at").unwrap().as_uint().unwrap(),
            )
        })
        .collect();
    (rows, v.get("total_bytes").unwrap().as_uint().unwrap())
}

fn control(f: &mut Fixture, signer: [u8; 32], kind: &str, inner: &str, args: Value) -> OpEnvelope {
    let cur = f.epoch().epoch;
    f.op_with(
        cur,
        signer,
        inner,
        Value::Map(vec![]),
        Some((signer, kind, args)),
    )
}

fn config(max_blob_bytes: usize, max_blob_bytes_total: u64) -> Config {
    Config {
        provisioning_token: Some(TOKEN.into()),
        operator_token: Some(OPERATOR.into()),
        max_blob_bytes,
        max_blob_bytes_total,
        ..Config::default()
    }
}

#[tokio::test]
async fn upload_download_round_trip_is_content_addressed_and_idempotent() {
    let app = node();
    let mut f = Fixture::new(90);
    create(&app, &mut f).await;
    let cid = f.cid;
    let t = member_token(&app, &f).await;
    let body = b"ciphertext of a file".to_vec();
    let id = blob_id(&body);

    let (s, v) = put(&app, &cid, &t, &body).await;
    assert_eq!((s, code(&v)), (StatusCode::OK, ""), "{v:?}");
    assert_eq!(v.get("blob_id").unwrap().as_bytes(), Some(&id[..]));
    assert_eq!(v.get("size").unwrap().as_uint(), Some(body.len() as u64));

    let (s, ct, got) = get(&app, &cid, &t, &id).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(ct.as_deref(), Some("application/octet-stream"));
    assert_eq!(got, body);

    // The same bytes again: the same answer, nothing stored twice.
    let (s, again) = put(&app, &cid, &t, &body).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(again, v);
    let mt = login(&app, &cid, &f.admin, "moderate").await.unwrap();
    let (_, l) = list(&app, &cid, &mt).await;
    let (rows, total) = listed(&l);
    assert_eq!(rows.len(), 1);
    assert_eq!(total, body.len() as u64);

    // Unknown blob, and ids that are not the hash of the body.
    let (s, _, _) = get(&app, &cid, &t, &blob_id(b"nothing")).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, v) = call_raw(
        &app,
        "PUT",
        &blob_uri(&cid, &blob_id(b"other")),
        Some(&t),
        Some(body.clone()),
        &[],
    )
    .await;
    assert_eq!((s, code(&v)), (StatusCode::BAD_REQUEST, "malformed"));
    let (s, v) = call_raw(
        &app,
        "PUT",
        &format!("/v1/c/{}/blobs/zz", hex(&cid)),
        Some(&t),
        Some(body.clone()),
        &[],
    )
    .await;
    assert_eq!((s, code(&v)), (StatusCode::BAD_REQUEST, "malformed"));
    // Nothing above landed.
    let (_, l) = list(&app, &cid, &mt).await;
    assert_eq!(listed(&l).0.len(), 1);

    // No token, or a token for another community: unauthorized.
    let (s, _, _) = call_bytes(&app, "GET", &blob_uri(&cid, &id), None, None, &[]).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let mut g = Fixture::new(91);
    create(&app, &mut g).await;
    let other = member_token(&app, &g).await;
    assert_eq!(
        get(&app, &cid, &other, &id).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn the_discovery_document_and_the_body_limit_follow_max_blob_bytes() {
    let app = node();
    let (_, v) = call(&app, "GET", "/.well-known/vamo-virar", None, None).await;
    assert!(
        v.as_text().unwrap().contains("\"max_blob_bytes\":11534336"),
        "{v:?}"
    );

    let app = node_with(config(16, 1 << 30));
    let (_, v) = call(&app, "GET", "/.well-known/vamo-virar", None, None).await;
    assert!(v.as_text().unwrap().contains("\"max_blob_bytes\":16"));
    let mut f = Fixture::new(92);
    create(&app, &mut f).await;
    let t = member_token(&app, &f).await;
    assert_eq!(put(&app, &f.cid, &t, &[7; 16]).await.0, StatusCode::OK);
    let (s, v) = put(&app, &f.cid, &t, &[7; 17]).await;
    assert_eq!(
        (s, code(&v)),
        (StatusCode::PAYLOAD_TOO_LARGE, "too_large"),
        "{v:?}"
    );
    // A declared length over the limit is refused before the body is read.
    let (s, v) = call_raw(
        &app,
        "PUT",
        &blob_uri(&f.cid, &blob_id(&[7; 17])),
        Some(&t),
        Some(vec![7; 17]),
        &[("content-length", "17")],
    )
    .await;
    assert_eq!((s, code(&v)), (StatusCode::PAYLOAD_TOO_LARGE, "too_large"));
}

#[tokio::test]
async fn the_blob_quota_counts_stored_bytes_and_deleting_frees_it() {
    let app = node_with(config(1024, 100));
    let mut f = Fixture::new(93);
    create(&app, &mut f).await;
    let cid = f.cid;
    let t = member_token(&app, &f).await;
    let mt = login(&app, &cid, &f.admin, "moderate").await.unwrap();

    let big = vec![1u8; 60];
    let small = vec![2u8; 50];
    assert_eq!(put(&app, &cid, &t, &big).await.0, StatusCode::OK);
    let (s, v) = put(&app, &cid, &t, &small).await;
    assert_eq!(
        (s, code(&v)),
        (StatusCode::INSUFFICIENT_STORAGE, "quota_exceeded"),
        "{v:?}"
    );
    // Re-uploading what is already there costs nothing.
    assert_eq!(put(&app, &cid, &t, &big).await.0, StatusCode::OK);
    let (_, l) = list(&app, &cid, &mt).await;
    assert_eq!(listed(&l).1, 60);

    let (s, _) = delete(&app, &cid, &mt, &blob_id(&big)).await;
    assert_eq!(s, StatusCode::OK);
    let (_, l) = list(&app, &cid, &mt).await;
    assert_eq!(listed(&l), (vec![], 0));
    assert_eq!(
        get(&app, &cid, &t, &blob_id(&big)).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(put(&app, &cid, &t, &small).await.0, StatusCode::OK);
    // Deleting again, or something that never existed, is still a success.
    assert_eq!(
        delete(&app, &cid, &mt, &blob_id(&big)).await.0,
        StatusCode::OK
    );
    assert_eq!(delete(&app, &cid, &mt, &[9; 32]).await.0, StatusCode::OK);
    let (_, l) = list(&app, &cid, &mt).await;
    assert_eq!(listed(&l).1, 50);

    // The operator sees the same number, per community and per node.
    let (s, body) = operator(&app, "GET", "/operator/v1/communities", Some(OPERATOR)).await;
    assert_eq!(s, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["communities"][0]["blob_bytes"], 50);
    let (_, body) = operator(&app, "GET", "/operator/v1/metrics", Some(OPERATOR)).await;
    assert!(String::from_utf8(body)
        .unwrap()
        .contains("vv_blob_bytes{tenant=\"\"} 50"));
}

#[tokio::test]
async fn a_tenant_may_set_its_own_blob_quota() {
    use sha2::Digest;
    let mut c = config(1024, 1 << 30);
    c.tenants = vec![Tenant {
        name: "acme".into(),
        token_sha256: hex(&sha2::Sha256::digest(b"acme-secret")),
        max_blob_bytes_total: Some(10),
        ..Tenant::default()
    }];
    let app = node_with(c);
    let mut f = Fixture::new(94);
    let g = f.genesis();
    let (s, _) = call_raw(
        &app,
        "POST",
        "/v1/communities",
        None,
        Some(cbor::encode(&Value::map([("genesis", g.to_value())]))),
        &[("x-vv-provision-token", "acme-secret")],
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let t = member_token(&app, &f).await;
    let (s, v) = put(&app, &f.cid, &t, &[3; 11]).await;
    assert_eq!(
        (s, code(&v)),
        (StatusCode::INSUFFICIENT_STORAGE, "quota_exceeded")
    );
    assert_eq!(put(&app, &f.cid, &t, &[3; 10]).await.0, StatusCode::OK);

    // A community provisioned with the node's own token gets the node default.
    let mut h = Fixture::new(95);
    create(&app, &mut h).await;
    let t2 = member_token(&app, &h).await;
    assert_eq!(put(&app, &h.cid, &t2, &[3; 11]).await.0, StatusCode::OK);

    let (_, body) = operator(&app, "GET", "/operator/v1/tenants", Some(OPERATOR)).await;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["tenants"][0]["blob_bytes"], 10);
    assert_eq!(v["tenants"][0]["max_blob_bytes_total_per_community"], 10);
}

#[tokio::test]
async fn listing_and_deleting_need_the_moderate_scope() {
    let app = node();
    let mut f = Fixture::new(96);
    create(&app, &mut f).await;
    let cid = f.cid;
    let admin = f.admin;
    let moderator = [0xc1u8; 32];
    let t = member_token(&app, &f).await;
    let set = control(
        &mut f,
        admin,
        "mod.set",
        "mod.set",
        Value::map([("moderators", Value::Array(vec![b(&public_key(&moderator))]))]),
    );
    first_result(&submit(&app, &cid, &t, vec![set]).await.1).unwrap();

    let bodies: Vec<Vec<u8>> = (0u8..3).map(|i| vec![i; 10 + i as usize]).collect();
    for body in &bodies {
        assert_eq!(put(&app, &cid, &t, body).await.0, StatusCode::OK);
    }

    // A member's token is not enough to list or delete.
    let (s, v) = list(&app, &cid, &t).await;
    assert_eq!((s, code(&v)), (StatusCode::UNAUTHORIZED, "unauthorized"));
    let (s, _) = delete(&app, &cid, &t, &blob_id(&bodies[0])).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let first = blob_id(&bodies[0]);
    assert_eq!(get(&app, &cid, &t, &first).await.0, StatusCode::OK);

    // A moderator (and an admin, whose `control` token also passes) can.
    let mt = login(&app, &cid, &moderator, "moderate").await.unwrap();
    let (s, l) = list(&app, &cid, &mt).await;
    assert_eq!(s, StatusCode::OK);
    let (rows, total) = listed(&l);
    assert_eq!(total, 10 + 11 + 12);
    let mut expected: Vec<(Vec<u8>, u64, u64)> = rows.clone();
    expected.sort_by_key(|r| (r.2, r.0.clone()));
    assert_eq!(rows, expected, "ordered by at, then blob_id");
    for body in &bodies {
        let hit = rows.iter().find(|r| r.0[..] == blob_id(body)[..]).unwrap();
        assert_eq!(hit.1, body.len() as u64);
        assert!(hit.2 > 0);
    }
    let ct = login(&app, &cid, &admin, "control").await.unwrap();
    let second = blob_id(&bodies[1]);
    assert_eq!(delete(&app, &cid, &ct, &first).await.0, StatusCode::OK);
    assert_eq!(delete(&app, &cid, &mt, &second).await.0, StatusCode::OK);
    let (_, l) = list(&app, &cid, &mt).await;
    assert_eq!(listed(&l).1, 12);
}

#[tokio::test]
async fn frozen_communities_take_no_uploads_but_still_serve_downloads() {
    let app = node_with(config(1024, 1 << 30));
    let mut f = Fixture::new(97);
    create(&app, &mut f).await;
    let cid = f.cid;
    let admin = f.admin;
    let t = member_token(&app, &f).await;
    let kept = b"kept".to_vec();
    let kept_id = blob_id(&kept);
    assert_eq!(put(&app, &cid, &t, &kept).await.0, StatusCode::OK);
    let uri = format!("/operator/v1/communities/{}", hex(&cid));

    operator(&app, "POST", &format!("{uri}/suspend"), Some(OPERATOR)).await;
    let (s, v) = put(&app, &cid, &t, b"new").await;
    assert_eq!((s, code(&v)), (StatusCode::FORBIDDEN, "suspended"));
    assert_eq!(get(&app, &cid, &t, &kept_id).await.0, StatusCode::OK);
    operator(&app, "POST", &format!("{uri}/resume"), Some(OPERATOR)).await;
    assert_eq!(put(&app, &cid, &t, b"new").await.0, StatusCode::OK);

    let m = f.migrate(admin, &["https://b.example"]);
    first_result(&submit(&app, &cid, &t, vec![m]).await.1).unwrap();
    let (s, v) = put(&app, &cid, &t, b"after move").await;
    assert_eq!((s, code(&v)), (StatusCode::CONFLICT, "moved"));
    assert_eq!(get(&app, &cid, &t, &kept_id).await.0, StatusCode::OK);
    let cancel = f.migrate(admin, &[]);
    first_result(&submit(&app, &cid, &t, vec![cancel]).await.1).unwrap();

    let disable = control(
        &mut f,
        admin,
        "disable",
        "community.disable",
        Value::Map(vec![]),
    );
    first_result(&submit(&app, &cid, &t, vec![disable]).await.1).unwrap();
    let (s, v) = put(&app, &cid, &t, b"after disable").await;
    assert_eq!((s, code(&v)), (StatusCode::FORBIDDEN, "disabled"));
    assert_eq!(get(&app, &cid, &t, &kept_id).await.0, StatusCode::OK);
    let mt = login(&app, &cid, &admin, "moderate").await.unwrap();
    assert_eq!(list(&app, &cid, &mt).await.0, StatusCode::OK);
}

#[tokio::test]
async fn blobs_go_with_the_purge_of_a_disabled_community() {
    let app = node();
    let mut f = Fixture::new(98);
    create(&app, &mut f).await;
    let cid = f.cid;
    let admin = f.admin;
    let t = member_token(&app, &f).await;
    assert_eq!(put(&app, &cid, &t, b"attachment").await.0, StatusCode::OK);
    let disable = control(
        &mut f,
        admin,
        "disable",
        "community.disable",
        Value::Map(vec![]),
    );
    first_result(&submit(&app, &cid, &t, vec![disable]).await.1).unwrap();

    let count = |app: &Arc<App>| -> u64 {
        app.store
            .lock()
            .unwrap()
            .conn()
            .query_row("SELECT COUNT(*) FROM blobs WHERE cid = ?1", [cid], |r| {
                r.get(0)
            })
            .unwrap()
    };
    app.clock.advance(29 * 24 * 3_600_000);
    app.housekeeping().unwrap();
    assert_eq!(count(&app), 1, "still there after 29 days");
    app.clock.advance(2 * 24 * 3_600_000);
    app.housekeeping().unwrap();
    assert_eq!(count(&app), 0);
    assert!(
        community_node::store::community(app.store.lock().unwrap().conn(), &cid)
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn a_restore_elsewhere_starts_without_blobs() {
    let a = node();
    let mut f = Fixture::new(99);
    create(&a, &mut f).await;
    let cid = f.cid;
    let t = member_token(&a, &f).await;
    let body = b"copied by the admin device, not by the node".to_vec();
    let id = blob_id(&body);
    assert_eq!(put(&a, &cid, &t, &body).await.0, StatusCode::OK);

    let ct = login(&a, &cid, &f.admin, "control").await.unwrap();
    let (s, export) = call(
        &a,
        "GET",
        &format!("/v1/c/{}/export", hex(&cid)),
        Some(&ct),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(export.get("blobs").is_none(), "the export has no blobs");

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
    let t2 = member_token(&b_node, &f).await;
    assert_eq!(get(&b_node, &cid, &t2, &id).await.0, StatusCode::NOT_FOUND);
    // The device re-uploads what the new node is missing.
    assert_eq!(put(&b_node, &cid, &t2, &body).await.0, StatusCode::OK);
    assert_eq!(get(&b_node, &cid, &t2, &id).await.2, body);
}
