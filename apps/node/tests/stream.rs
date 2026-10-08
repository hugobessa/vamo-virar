mod common;

use std::time::Duration;

use common::*;
use futures_util::StreamExt;
use tokio_tungstenite::tungstenite::Message;
use vv_crypto::cbor::{self, Value};
use vv_crypto::keys::mailbox_id;
use vv_crypto::primitives::public_key;

async fn next(
    ws: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin),
) -> Option<Value> {
    match tokio::time::timeout(Duration::from_millis(500), ws.next()).await {
        Ok(Some(Ok(Message::Binary(b)))) => Some(cbor::decode(&b).unwrap()),
        _ => None,
    }
}

#[tokio::test]
async fn notifies_new_heads_and_own_mailbox_only() {
    let app = node();
    let mut f = Fixture::new(20);
    create(&app, &mut f).await;
    let cid = f.cid;
    let ct = login(&app, &cid, &f.epoch().eak_seed.clone(), "community")
        .await
        .unwrap();
    let alice = [21; 32];
    let mt = login(&app, &cid, &alice, "mailbox").await.unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let served = app.clone();
    tokio::spawn(async move {
        axum::serve(listener, community_node::service(served))
            .await
            .unwrap()
    });

    let url = format!(
        "ws://{addr}/v1/c/{}/stream?token={ct}&mailbox_token={mt}",
        hex(&cid)
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    assert_eq!(
        next(&mut ws).await,
        Some(Value::map([("head_seq", Value::Int(1))]))
    );

    let op = f.data([50; 32]);
    submit(&app, &cid, &ct, vec![op]).await;
    assert_eq!(
        next(&mut ws).await,
        Some(Value::map([("head_seq", Value::Int(2))]))
    );

    let item = Value::map([
        ("kind", Value::Text("probe".into())),
        ("ct", b(&[1])),
        ("ttl_s", Value::Int(60)),
    ]);
    let other_box = mailbox_id(&cid, &public_key(&[22; 32]));
    call(
        &app,
        "POST",
        &format!("/v1/c/{}/mailbox/{}", hex(&cid), hex(&other_box)),
        Some(&ct),
        Some(item.clone()),
    )
    .await;
    assert_eq!(
        next(&mut ws).await,
        None,
        "someone else's mailbox is not announced"
    );

    let own_box = mailbox_id(&cid, &public_key(&alice));
    call(
        &app,
        "POST",
        &format!("/v1/c/{}/mailbox/{}", hex(&cid), hex(&own_box)),
        Some(&ct),
        Some(item),
    )
    .await;
    assert_eq!(
        next(&mut ws).await,
        Some(Value::map([("mailbox", b(&own_box))]))
    );
}

#[tokio::test]
async fn refuses_bad_tokens() {
    let app = node();
    let mut f = Fixture::new(23);
    create(&app, &mut f).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let served = app.clone();
    tokio::spawn(async move {
        axum::serve(listener, community_node::service(served))
            .await
            .unwrap()
    });
    let url = format!("ws://{addr}/v1/c/{}/stream?token=nope", hex(&f.cid));
    assert!(tokio_tungstenite::connect_async(url).await.is_err());
}
