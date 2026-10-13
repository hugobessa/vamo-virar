//! Push wake-ups (protocol.md §14): a device registers a token for its
//! mailbox; a `ping` for that mailbox becomes one content-free call to the
//! gateway; nothing else leaks, and dead tokens are forgotten.

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use common::*;
use community_node::Config;
use vv_crypto::cbor::Value;
use vv_crypto::keys::mailbox_id;
use vv_crypto::primitives::public_key;

/// A stand-in gateway: records every request body and answers like Expo.
struct Gateway {
    url: String,
    received: Arc<Mutex<Vec<serde_json::Value>>>,
    /// Ticket error to answer with, if any.
    error: Arc<Mutex<Option<&'static str>>>,
}

async fn gateway() -> Gateway {
    let received = Arc::new(Mutex::new(Vec::new()));
    let error: Arc<Mutex<Option<&'static str>>> = Arc::new(Mutex::new(None));
    let (r, e) = (received.clone(), error.clone());
    let app = Router::new().route(
        "/send",
        post(move |Json(body): Json<serde_json::Value>| {
            let (r, e) = (r.clone(), e.clone());
            async move {
                r.lock().unwrap().push(body);
                let ticket = match *e.lock().unwrap() {
                    Some(code) => serde_json::json!({"status": "error", "message": "x", "details": {"error": code}}),
                    None => serde_json::json!({"status": "ok", "id": "t1"}),
                };
                Json(serde_json::json!({ "data": [ticket] }))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Gateway {
        url: format!("http://{addr}/send"),
        received,
        error,
    }
}

async fn settle(g: &Gateway, n: usize) {
    for _ in 0..100 {
        if g.received.lock().unwrap().len() >= n {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn item(kind: &str) -> Value {
    Value::map([
        ("kind", Value::Text(kind.into())),
        ("ct", b(&[1, 2, 3])),
        ("ttl_s", Value::Int(60)),
    ])
}

#[tokio::test]
async fn pings_become_content_free_pushes_for_registered_mailboxes_only() {
    let g = gateway().await;
    let app = node_with(Config {
        provisioning_token: Some(TOKEN.into()),
        push_gateway: Some(g.url.clone()),
        push_access_token: Some("gw-secret".into()),
        push_min_interval_secs: 0,
        ..Config::default()
    });
    let mut f = Fixture::new(21);
    create(&app, &mut f).await;
    let cid = f.cid;
    let ct = login(&app, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let alice = [31; 32];
    let alice_box = mailbox_id(&cid, &public_key(&alice));
    let at = login(&app, &cid, &alice, "mailbox").await.unwrap();
    let push = format!("/v1/c/{}/push", hex(&cid));
    let mailbox = format!("/v1/c/{}/mailbox/{}", hex(&cid), hex(&alice_box));

    // Advertised, and registration needs the mailbox scope.
    let (_, v) = call(&app, "GET", "/.well-known/vamo-virar", None, None).await;
    assert!(v.as_text().unwrap().contains("\"push\":true"));
    let token = Value::map([("token", Value::Text("ExponentPushToken[abc]".into()))]);
    assert_eq!(
        call(&app, "PUT", &push, Some(&ct), Some(token.clone()))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            &push,
            Some(&at),
            Some(Value::map([("token", Value::Text("".into()))]))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (s, v) = call(&app, "PUT", &push, Some(&at), Some(token)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v.get("push"), Some(&Value::Bool(true)));

    // A key envelope is routine: no push. A ping wakes the device, with nothing about why.
    call(&app, "POST", &mailbox, Some(&ct), Some(item("key_env"))).await;
    call(&app, "POST", &mailbox, Some(&ct), Some(item("ping"))).await;
    settle(&g, 1).await;
    let got = g.received.lock().unwrap().clone();
    assert_eq!(got.len(), 1, "{got:?}");
    let msg = &got[0][0];
    assert_eq!(msg["to"], "ExponentPushToken[abc]");
    assert_eq!(msg["channelId"], "default");
    let text = got[0].to_string();
    assert!(
        !text.contains(&hex(&cid)) && !text.contains(&hex(&alice_box)) && !text.contains("ping")
    );

    // A mailbox nobody registered for stays quiet.
    let other_box = mailbox_id(&cid, &public_key(&[32; 32]));
    let other = format!("/v1/c/{}/mailbox/{}", hex(&cid), hex(&other_box));
    call(&app, "POST", &other, Some(&ct), Some(item("ping"))).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(g.received.lock().unwrap().len(), 1);

    // The gateway reports the token dead: it is dropped, and a later ping sends nothing.
    *g.error.lock().unwrap() = Some("DeviceNotRegistered");
    call(&app, "POST", &mailbox, Some(&ct), Some(item("probe"))).await;
    settle(&g, 2).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    *g.error.lock().unwrap() = None;
    call(&app, "POST", &mailbox, Some(&ct), Some(item("ping"))).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(g.received.lock().unwrap().len(), 2);

    // Register again, then unregister: DELETE needs the mailbox scope too.
    let (s, _) = call(
        &app,
        "PUT",
        &push,
        Some(&at),
        Some(Value::map([(
            "token",
            Value::Text("ExponentPushToken[new]".into()),
        )])),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        call(&app, "DELETE", &push, Some(&ct), None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&app, "DELETE", &push, Some(&at), None).await.0,
        StatusCode::OK
    );
    call(&app, "POST", &mailbox, Some(&ct), Some(item("ping"))).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(g.received.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn one_push_per_window_and_none_without_a_gateway() {
    let g = gateway().await;
    let app = node_with(Config {
        provisioning_token: Some(TOKEN.into()),
        push_gateway: Some(g.url.clone()),
        push_min_interval_secs: 60,
        ..Config::default()
    });
    let mut f = Fixture::new(22);
    create(&app, &mut f).await;
    let cid = f.cid;
    let ct = login(&app, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let alice = [33; 32];
    let alice_box = mailbox_id(&cid, &public_key(&alice));
    let at = login(&app, &cid, &alice, "mailbox").await.unwrap();
    let push = format!("/v1/c/{}/push", hex(&cid));
    let mailbox = format!("/v1/c/{}/mailbox/{}", hex(&cid), hex(&alice_box));
    call(
        &app,
        "PUT",
        &push,
        Some(&at),
        Some(Value::map([(
            "token",
            Value::Text("ExponentPushToken[w]".into()),
        )])),
    )
    .await;
    for _ in 0..3 {
        call(&app, "POST", &mailbox, Some(&ct), Some(item("ping"))).await;
    }
    settle(&g, 1).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(g.received.lock().unwrap().len(), 1);
    // The window passes (housekeeping forgets the old stamp too).
    app.clock.advance(61_000);
    app.housekeeping().unwrap();
    call(&app, "POST", &mailbox, Some(&ct), Some(item("ping"))).await;
    settle(&g, 2).await;
    assert_eq!(g.received.lock().unwrap().len(), 2);

    // Without a gateway, registration is accepted (the device cannot know
    // better) but says so, and nothing is sent anywhere.
    let quiet = node();
    let mut f2 = Fixture::new(23);
    create(&quiet, &mut f2).await;
    let (_, v) = call(&quiet, "GET", "/.well-known/vamo-virar", None, None).await;
    assert!(v.as_text().unwrap().contains("\"push\":false"));
    let at2 = login(&quiet, &f2.cid, &alice, "mailbox").await.unwrap();
    let (s, v) = call(
        &quiet,
        "PUT",
        &format!("/v1/c/{}/push", hex(&f2.cid)),
        Some(&at2),
        Some(Value::map([(
            "token",
            Value::Text("ExponentPushToken[q]".into()),
        )])),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v.get("push"), Some(&Value::Bool(false)));
}
