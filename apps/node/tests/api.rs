mod common;

use axum::http::StatusCode;
use common::*;
use vv_crypto::cbor::Value;
use vv_crypto::envelope::LogEntry;
use vv_crypto::keys::mailbox_id;
use vv_crypto::primitives::{hash_ctx, public_key};

fn entries(v: &Value) -> Vec<LogEntry> {
    let Value::Array(items) = v.get("entries").unwrap() else {
        panic!("entries")
    };
    items
        .iter()
        .map(|e| LogEntry::decode(&vv_crypto::cbor::encode(e)).unwrap())
        .collect()
}

#[tokio::test]
async fn well_known_and_provisioning() {
    let app = node();
    let (s, v) = call(&app, "GET", "/.well-known/vamo-virar", None, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(v.as_text().unwrap().contains(&hex(&app.node_id)));

    let mut f = Fixture::new(1);
    let g = f.genesis();
    // No token: provisioning is refused.
    let body = vv_crypto::cbor::encode(&Value::map([("genesis", g.to_value())]));
    let (s, _) = call_raw(
        &app,
        "POST",
        "/v1/communities",
        None,
        Some(body.clone()),
        &[],
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = call_raw(
        &app,
        "POST",
        "/v1/communities",
        None,
        Some(body.clone()),
        &[("x-vv-provision-token", "nope")],
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, v) = call_raw(
        &app,
        "POST",
        "/v1/communities",
        None,
        Some(body.clone()),
        &[("x-vv-provision-token", TOKEN)],
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v.get("community_id").unwrap().as_bytes().unwrap(), f.cid);
    let (s, _) = call_raw(
        &app,
        "POST",
        "/v1/communities",
        None,
        Some(body),
        &[("x-vv-provision-token", TOKEN)],
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn genesis_must_match_its_community_id() {
    let app = node();
    let mut f = Fixture::new(2);
    f.crk = [99; 32]; // signer no longer hashes to cid
    let (s, _) = create(&app, &mut f).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn sequencing_dedupe_and_hash_chain() {
    let app = node();
    let mut f = Fixture::new(3);
    assert_eq!(create(&app, &mut f).await.0, StatusCode::OK);
    let token = login(&app, &f.cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();

    let op = f.data([50; 32]);
    let (s, v) = submit(&app, &f.cid, &token, vec![op.clone()]).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(first_result(&v), Ok(2));
    // Retransmission is idempotent…
    assert_eq!(
        first_result(&submit(&app, &f.cid, &token, vec![op.clone()]).await.1),
        Ok(2)
    );
    // …but reusing an op_id for different content is a conflict.
    let mut other = f.data([50; 32]);
    other.op_id = op.op_id;
    assert_eq!(
        first_result(&submit(&app, &f.cid, &token, vec![other]).await.1),
        Err("op_conflict".into())
    );

    // A tampered envelope is refused.
    let mut bad = f.data([50; 32]);
    bad.ct[0] ^= 1;
    assert_eq!(
        first_result(&submit(&app, &f.cid, &token, vec![bad]).await.1),
        Err("unauthorized".into())
    );

    let (s, v) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops?after=0", hex(&f.cid)),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let es = entries(&v);
    assert_eq!(es.len(), 2);
    assert_eq!(es[0].prev, [0; 32]);
    assert_eq!(es[1].prev, es[0].hash());
    assert!(es[1].at >= es[0].at);
    assert_eq!(v.get("head_seq").unwrap().as_uint(), Some(2));

    let (_, v) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops?after=1", hex(&f.cid)),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(entries(&v).len(), 1);
}

#[tokio::test]
async fn auth_rules() {
    let app = node();
    let mut f = Fixture::new(4);
    create(&app, &mut f).await;
    let cid = f.cid;

    // Wrong key for scope.
    assert_eq!(
        login(&app, &cid, &[1; 32], "community").await,
        Err(StatusCode::UNAUTHORIZED)
    );
    assert_eq!(
        login(&app, &cid, &[1; 32], "control").await,
        Err(StatusCode::UNAUTHORIZED)
    );
    assert!(login(&app, &cid, &f.admin, "control").await.is_ok());
    // Any key can open its own mailbox.
    assert!(login(&app, &cid, &[1; 32], "mailbox").await.is_ok());
    // Unknown community.
    assert_eq!(
        login(&app, &[0; 32], &[1; 32], "mailbox").await,
        Err(StatusCode::NOT_FOUND)
    );

    // No token / wrong scope token.
    let (s, _) = call(&app, "GET", &format!("/v1/c/{}/ops", hex(&cid)), None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let mbx = login(&app, &cid, &[1; 32], "mailbox").await.unwrap();
    let (s, _) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&mbx),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn rotation_grace_window_and_revocation() {
    let app = node();
    let mut f = Fixture::new(5);
    create(&app, &mut f).await;
    let cid = f.cid;
    let old_eak = f.epoch().eak_seed;
    let t0 = login(&app, &cid, &old_eak, "community").await.unwrap();

    // A non-admin cannot rotate.
    let rogue = f.rotate([42; 32]);
    f.epochs.pop();
    assert_eq!(
        first_result(&submit(&app, &cid, &t0, vec![rogue]).await.1),
        Err("unauthorized".into())
    );

    let admin = f.admin;
    let rot = f.rotate(admin);
    assert_eq!(
        first_result(&submit(&app, &cid, &t0, vec![rot]).await.1),
        Ok(2)
    );
    // A second rotation to the same epoch conflicts.
    f.epochs.pop();
    let dup = f.rotate(admin);
    assert_eq!(
        first_result(&submit(&app, &cid, &t0, vec![dup]).await.1),
        Err("epoch_conflict".into())
    );

    // During the grace window, old-epoch data ops and tokens still work.
    let late = f.op_with(0, [50; 32], "member.profile", Value::Map(vec![]), None);
    assert_eq!(
        first_result(&submit(&app, &cid, &t0, vec![late]).await.1),
        Ok(3)
    );

    app.clock.advance(11 * 60 * 1000);
    let later = f.op_with(0, [50; 32], "member.profile", Value::Map(vec![]), None);
    let (s, _) = submit(&app, &cid, &t0, vec![later]).await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "old-epoch token revoked after grace"
    );

    let t1 = login(&app, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let stale = f.op_with(0, [50; 32], "member.profile", Value::Map(vec![]), None);
    assert_eq!(
        first_result(&submit(&app, &cid, &t1, vec![stale]).await.1),
        Err("epoch_stale".into())
    );
    let fresh = f.data([50; 32]);
    assert_eq!(
        first_result(&submit(&app, &cid, &t1, vec![fresh]).await.1),
        Ok(4)
    );
}

#[tokio::test]
async fn crk_can_reset_the_admin_set() {
    let app = node();
    let mut f = Fixture::new(6);
    create(&app, &mut f).await;
    let t = login(&app, &f.cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let crk = f.crk;
    let new_admin = [77; 32];
    let op = f.admin_set(crk, &[new_admin]);
    assert_eq!(
        first_result(&submit(&app, &f.cid, &t, vec![op]).await.1),
        Ok(2)
    );
    assert!(login(&app, &f.cid, &new_admin, "control").await.is_ok());
    assert_eq!(
        login(&app, &f.cid, &f.admin, "control").await,
        Err(StatusCode::UNAUTHORIZED)
    );
    // A non-admin cannot.
    let op = f.admin_set([5; 32], &[[5; 32]]);
    assert_eq!(
        first_result(&submit(&app, &f.cid, &t, vec![op]).await.1),
        Err("unauthorized".into())
    );
}

#[tokio::test]
async fn mailboxes() {
    let app = node();
    let mut f = Fixture::new(7);
    create(&app, &mut f).await;
    let cid = f.cid;
    let ct = login(&app, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let alice = [11; 32];
    let alice_box = mailbox_id(&cid, &public_key(&alice));
    let at = login(&app, &cid, &alice, "mailbox").await.unwrap();
    let bt = login(&app, &cid, &[12; 32], "mailbox").await.unwrap();
    let path = format!("/v1/c/{}/mailbox/{}", hex(&cid), hex(&alice_box));

    let post = |kind: &str, ttl: i64| {
        Value::map([
            ("kind", Value::Text(kind.into())),
            ("ct", b(&[1, 2, 3])),
            ("ttl_s", Value::Int(ttl)),
        ])
    };
    assert_eq!(
        call(&app, "POST", &path, Some(&ct), Some(post("key_env", 1)))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "POST", &path, Some(&ct), Some(post("probe", 60)))
            .await
            .0,
        StatusCode::OK
    );
    // Posting needs community scope.
    assert_eq!(
        call(&app, "POST", &path, Some(&at), Some(post("probe", 60)))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );

    let (s, v) = call(&app, "GET", &path, Some(&at), None).await;
    assert_eq!(s, StatusCode::OK);
    let Value::Array(items) = v.get("items").unwrap() else {
        panic!()
    };
    assert_eq!(items.len(), 2);
    // Bob cannot read Alice's mailbox.
    assert_eq!(
        call(&app, "GET", &path, Some(&bt), None).await.0,
        StatusCode::UNAUTHORIZED
    );

    // Removal notices also persist.
    assert_eq!(
        call(&app, "POST", &path, Some(&ct), Some(post("removed", 1)))
            .await
            .0,
        StatusCode::OK
    );
    // The probe expires; the key envelope and removal notice stay until acknowledged.
    app.clock.advance(61_000);
    app.housekeeping().unwrap();
    let (_, v) = call(&app, "GET", &path, Some(&at), None).await;
    let Value::Array(items) = v.get("items").unwrap() else {
        panic!()
    };
    assert_eq!(items.len(), 2);
    for item in items {
        let id = item.get("id").unwrap().as_uint().unwrap();
        assert_eq!(
            call(&app, "DELETE", &format!("{path}/{id}"), Some(&at), None)
                .await
                .0,
            StatusCode::OK
        );
    }
    let (_, v) = call(&app, "GET", &path, Some(&at), None).await;
    assert_eq!(v.get("items"), Some(&Value::Array(vec![])));
}

#[tokio::test]
async fn intake_invites_and_rate_limits() {
    let app = node();
    let mut f = Fixture::new(8);
    create(&app, &mut f).await;
    let cid = f.cid;
    let ctl = login(&app, &cid, &f.admin, "control").await.unwrap();
    let path = format!("/v1/c/{}/intake", hex(&cid));
    let req = |invite: Option<&[u8]>| {
        let mut m = vec![("enc", b(&[3; 32])), ("ct", b(&[4; 40]))];
        if let Some(i) = invite {
            m.push(("invite", b(i)));
        }
        Value::map(m)
    };

    assert_eq!(
        call(&app, "POST", &path, None, Some(req(None))).await.0,
        StatusCode::OK
    );
    let (s, v) = call(&app, "GET", &path, Some(&ctl), None).await;
    assert_eq!(s, StatusCode::OK);
    let Value::Array(items) = v.get("items").unwrap() else {
        panic!()
    };
    assert_eq!(items.len(), 1);

    // Invite-only: the node checks the hash of the invite secret.
    let policy = format!("/v1/c/{}/intake-policy", hex(&cid));
    let p = Value::map([("mode", Value::Text("invite_only".into()))]);
    assert_eq!(
        call(&app, "PUT", &policy, Some(&ctl), Some(p)).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "POST", &path, None, Some(req(None))).await.0,
        StatusCode::UNAUTHORIZED
    );
    let secret = [9u8; 32];
    let hash = hash_ctx("vv/invite/v1", &[&secret]);
    let inv = Value::map([
        ("hash", b(&hash)),
        ("expires_at", Value::Int(i64::MAX >> 12)),
        ("max_uses", Value::Int(1)),
    ]);
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/v1/c/{}/invites", hex(&cid)),
            Some(&ctl),
            Some(inv)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "POST", &path, None, Some(req(Some(&secret))))
            .await
            .0,
        StatusCode::OK
    );
    // Single use.
    assert_eq!(
        call(&app, "POST", &path, None, Some(req(Some(&secret))))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );

    // Open again, then exhaust the per-IP window.
    let p = Value::map([("mode", Value::Text("open".into()))]);
    call(&app, "PUT", &policy, Some(&ctl), Some(p)).await;
    let mut last = StatusCode::OK;
    for _ in 0..25 {
        last = call(&app, "POST", &path, None, Some(req(None))).await.0;
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn snapshots_compaction_and_gone() {
    let app = node();
    let mut f = Fixture::new(9);
    create(&app, &mut f).await;
    let cid = f.cid;
    let k = f.epoch().eak_seed;
    let t = login(&app, &cid, &k, "community").await.unwrap();
    let ops: Vec<_> = (0..5).map(|_| f.data([50; 32])).collect();
    submit(&app, &cid, &t, ops).await;
    let admin = f.admin;
    let rot = f.rotate(admin);
    submit(&app, &cid, &t, vec![rot]).await; // seq 7, control
    let t = login(&app, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let ops: Vec<_> = (0..3).map(|_| f.data([50; 32])).collect();
    submit(&app, &cid, &t, ops).await; // seqs 8..10

    let (_, v) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    let log = entries(&v);
    assert_eq!(log.len(), 10);

    // A snapshot at seq 8, signed with the epoch-1 access key.
    let snap_for = |seq: u64, head: [u8; 32], f: &Fixture| {
        let mut s = vv_crypto::snapshot::SnapshotEnvelope {
            cid,
            seq,
            head,
            epoch: 1,
            nonce: [1; 24],
            ct: vec![5; 64],
            asig: [0; 64],
        };
        let mut h = vec![
            ("cid", b(&s.cid)),
            ("seq", Value::Int(seq as i64)),
            ("head", b(&s.head)),
            ("epoch", Value::Int(1)),
        ];
        h.push(("nonce", b(&s.nonce)));
        h.push(("ct", b(&s.ct)));
        s.asig = vv_crypto::primitives::sign(
            &f.epoch().eak_seed,
            "vv/snapshot-access/v1",
            &vv_crypto::cbor::encode(&Value::map(h)),
        );
        s
    };
    let path = format!("/v1/c/{}/snapshot", hex(&cid));
    // Members (epoch access key only) cannot upload snapshots; admins can.
    let good = snap_for(8, log[7].hash(), &f);
    let (s, _) = call_raw(&app, "PUT", &path, Some(&t), Some(good.encode()), &[]).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let ctl = login(&app, &cid, &f.admin, "control").await.unwrap();
    let wrong = snap_for(8, [0; 32], &f);
    let (s, _) = call_raw(&app, "PUT", &path, Some(&ctl), Some(wrong.encode()), &[]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "head must match the log");
    let (s, v) = call_raw(&app, "PUT", &path, Some(&ctl), Some(good.encode()), &[]).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    let (s, v) = call(&app, "GET", &path, Some(&t), None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        vv_crypto::snapshot::SnapshotEnvelope::from_value(&v).unwrap(),
        good
    );

    // Not compacted until the grace period passes.
    app.housekeeping().unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/v1/c/{}/ops?after=0", hex(&cid)),
            Some(&t),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    app.clock.advance(31 * 24 * 3600 * 1000);
    app.housekeeping().unwrap();
    let t = login(&app, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let (s, v) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops?after=0", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::GONE);
    assert_eq!(v.get("snapshot_seq").unwrap().as_uint(), Some(8));
    let (_, v) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops?after=8", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    assert_eq!(
        entries(&v).iter().map(|e| e.seq).collect::<Vec<_>>(),
        vec![9, 10]
    );
    // Control entries survive compaction.
    let (_, v) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/control", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    assert_eq!(
        entries(&v).iter().map(|e| e.seq).collect::<Vec<_>>(),
        vec![1, 7]
    );
}

#[tokio::test]
async fn restore_on_a_new_node() {
    let app = node();
    let mut f = Fixture::new(10);
    create(&app, &mut f).await;
    let cid = f.cid;
    let t = login(&app, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let admin = f.admin;
    let ops = vec![f.data([50; 32]), f.rotate(admin)];
    submit(&app, &cid, &t, ops).await;
    let t = login(&app, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let ops: Vec<_> = (0..4).map(|_| f.data([50; 32])).collect();
    submit(&app, &cid, &t, ops).await;
    let (_, v) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    let log = entries(&v);
    let (_, v) = call(
        &app,
        "GET",
        &format!("/v1/c/{}/control", hex(&cid)),
        Some(&t),
        None,
    )
    .await;
    let control = entries(&v);

    let fresh = node();
    let body = |control: &[LogEntry], tail: &[LogEntry]| {
        vv_crypto::cbor::encode(&Value::map([
            (
                "control_chain",
                Value::Array(control.iter().map(|e| e.to_value()).collect()),
            ),
            (
                "tail",
                Value::Array(tail.iter().map(|e| e.to_value()).collect()),
            ),
        ]))
    };
    // A tampered tail is refused.
    let mut bad = log[1..].to_vec();
    bad[2].at += 1;
    let (s, _) = call_raw(
        &fresh,
        "POST",
        "/v1/communities/restore",
        None,
        Some(body(&control, &bad)),
        &[("x-vv-provision-token", TOKEN)],
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let (s, v) = call_raw(
        &fresh,
        "POST",
        "/v1/communities/restore",
        None,
        Some(body(&control, &log[1..])),
        &[("x-vv-provision-token", TOKEN)],
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v.get("head_seq").unwrap().as_uint(), Some(log.len() as u64));

    // The restored node serves the same log and keeps sequencing from it.
    let t2 = login(&fresh, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let (_, v) = call(
        &fresh,
        "GET",
        &format!("/v1/c/{}/ops", hex(&cid)),
        Some(&t2),
        None,
    )
    .await;
    assert_eq!(entries(&v), log);
    let next = f.data([50; 32]);
    assert_eq!(
        first_result(&submit(&fresh, &cid, &t2, vec![next]).await.1),
        Ok(log.len() as u64 + 1)
    );
    let (_, v) = call(
        &fresh,
        "GET",
        &format!("/v1/c/{}/ops?after={}", hex(&cid), log.len()),
        Some(&t2),
        None,
    )
    .await;
    assert_eq!(entries(&v)[0].prev, log.last().unwrap().hash());
}
