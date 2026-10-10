//! Disabling a community (`disable` / `enable`, protocol.md §11.5).

mod common;

use axum::http::StatusCode;
use common::*;
use vv_crypto::cbor::Value;
use vv_crypto::envelope::OpEnvelope;

fn code(v: &Value) -> &str {
    v.get("code").and_then(Value::as_text).unwrap_or("")
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

fn disable(f: &mut Fixture, signer: [u8; 32]) -> OpEnvelope {
    control(
        f,
        signer,
        "disable",
        "community.disable",
        Value::Map(vec![]),
    )
}

fn enable(f: &mut Fixture, signer: [u8; 32]) -> OpEnvelope {
    control(f, signer, "enable", "community.enable", Value::Map(vec![]))
}

async fn member_token(app: &std::sync::Arc<community_node::App>, f: &Fixture) -> String {
    login(app, &f.cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap()
}

#[tokio::test]
async fn a_disabled_community_refuses_writes_until_another_admin_enables_it() {
    let app = node();
    let mut f = Fixture::new(70);
    create(&app, &mut f).await;
    let cid = f.cid;
    let admin = f.admin;
    let other = [0xb1u8; 32];
    let t = member_token(&app, &f).await;
    let set = f.admin_set(f.admin, &[f.admin, other]);
    let (_, v) = submit(&app, &cid, &t, vec![set]).await;
    first_result(&v).unwrap();

    let (_, v) = submit(&app, &cid, &t, vec![disable(&mut f, admin)]).await;
    first_result(&v).unwrap();

    let (s, v) = submit(&app, &cid, &t, vec![f.data([50; 32])]).await;
    assert_eq!((s, code(&v)), (StatusCode::FORBIDDEN, "disabled"));
    let (s, v) = call(
        &app,
        "POST",
        &format!("/v1/c/{}/intake", hex(&cid)),
        None,
        Some(Value::map([("enc", b(&[1; 32])), ("ct", b(&[1, 2, 3]))])),
    )
    .await;
    assert_eq!((s, code(&v)), (StatusCode::FORBIDDEN, "disabled"));
    // Reading still works.
    let (s, _) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    // The admin who disabled it cannot re-enable it; another admin can.
    let (_, v) = submit(&app, &cid, &t, vec![enable(&mut f, admin)]).await;
    assert!(first_result(&v).is_err());
    let (_, v) = submit(&app, &cid, &t, vec![enable(&mut f, other)]).await;
    first_result(&v).unwrap();
    let (_, v) = submit(&app, &cid, &t, vec![f.data([50; 32])]).await;
    first_result(&v).unwrap();
    // Enabling a community that is not disabled is refused.
    let (_, v) = submit(&app, &cid, &t, vec![enable(&mut f, other)]).await;
    assert!(first_result(&v).is_err());
}

#[tokio::test]
async fn a_disabled_community_is_deleted_after_thirty_days() {
    let app = node();
    let mut f = Fixture::new(80);
    create(&app, &mut f).await;
    let cid = f.cid;
    let admin = f.admin;
    let t = member_token(&app, &f).await;
    let (_, v) = submit(&app, &cid, &t, vec![disable(&mut f, admin)]).await;
    first_result(&v).unwrap();

    app.clock.advance(29 * 24 * 3_600_000);
    app.housekeeping().unwrap();
    let t = member_token(&app, &f).await; // sessions last an hour
    let (s, _) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "still there after 29 days");

    app.clock.advance(2 * 24 * 3_600_000);
    app.housekeeping().unwrap();
    let (s, v) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    assert!(
        s == StatusCode::NOT_FOUND || s == StatusCode::UNAUTHORIZED,
        "{s} {v:?}"
    );
    assert!(
        community_node::store::community(app.store.lock().unwrap().conn(), &cid)
            .unwrap()
            .is_none()
    );
}
