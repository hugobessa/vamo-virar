//! Moderators (`mod.set`, protocol.md §9.2): rotations, the `moderate`
//! token scope, and who may change the set.

mod common;

use axum::http::StatusCode;
use common::*;
use vv_crypto::cbor::Value;
use vv_crypto::envelope::OpEnvelope;
use vv_crypto::primitives::public_key;

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

async fn member_token(app: &std::sync::Arc<community_node::App>, f: &Fixture) -> String {
    login(app, &f.cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap()
}

#[tokio::test]
async fn moderators_may_rotate_and_read_intake_but_not_set_moderators() {
    let app = node();
    let mut f = Fixture::new(60);
    create(&app, &mut f).await;
    let cid = f.cid;
    let admin = f.admin;
    let moderator = [0xa1u8; 32];

    // Not a moderator yet: no `moderate` token, no rotation.
    assert!(login(&app, &cid, &moderator, "moderate").await.is_err());
    let t = member_token(&app, &f).await;
    let rot = f.rotate(moderator);
    f.epochs.pop();
    let (_, v) = submit(&app, &cid, &t, vec![rot]).await;
    assert!(first_result(&v).is_err());

    let args = Value::map([("moderators", Value::Array(vec![b(&public_key(&moderator))]))]);
    let set = control(&mut f, moderator, "mod.set", "mod.set", args.clone());
    let (_, v) = submit(&app, &cid, &t, vec![set]).await;
    assert!(
        first_result(&v).is_err(),
        "a moderator cannot name moderators"
    );
    let set = control(&mut f, admin, "mod.set", "mod.set", args);
    let (_, v) = submit(&app, &cid, &t, vec![set]).await;
    first_result(&v).unwrap();

    let mt = login(&app, &cid, &moderator, "moderate").await.unwrap();
    let (s, _) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/intake", hex(&cid)),
        Some(&mt),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // `control` stays admin-only.
    assert!(login(&app, &cid, &moderator, "control").await.is_err());
    let rot = f.rotate(moderator);
    let (_, v) = submit(&app, &cid, &t, vec![rot]).await;
    first_result(&v).unwrap();

    // An empty set removes every moderator.
    let t = member_token(&app, &f).await;
    let clear = control(
        &mut f,
        admin,
        "mod.set",
        "mod.set",
        Value::map([("moderators", Value::Array(vec![]))]),
    );
    let (_, v) = submit(&app, &cid, &t, vec![clear]).await;
    first_result(&v).unwrap();
    let (s, _) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/intake", hex(&cid)),
        Some(&mt),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}
