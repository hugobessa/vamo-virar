#![allow(dead_code)]

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use community_node::store::Store;
use community_node::{service, App, Config};
use http_body_util::BodyExt;
use tower::ServiceExt;
use vv_crypto::cbor::{self, Value};
use vv_crypto::ctx;
use vv_crypto::envelope::{seal_op, OpEnvelope, SealOp};
use vv_crypto::keys::{community_id, EpochKeys};
use vv_crypto::primitives::{public_key, sign};

pub const TOKEN: &str = "test-provisioning-token";

pub fn node() -> Arc<App> {
    let config = Config {
        provisioning_token: Some(TOKEN.into()),
        ..Config::default()
    };
    Arc::new(App::new(config, Store::open_in_memory().unwrap()).unwrap())
}

pub fn b(v: &[u8]) -> Value {
    Value::Bytes(v.to_vec())
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A community as an admin device sees it.
pub struct Fixture {
    pub crk: [u8; 32],
    pub cid: [u8; 32],
    pub admin: [u8; 32],
    pub epochs: Vec<EpochKeys>,
    counter: u8,
}

impl Fixture {
    pub fn new(seed: u8) -> Fixture {
        let crk = [seed; 32];
        let cid = community_id(&public_key(&crk));
        Fixture {
            crk,
            cid,
            admin: [seed.wrapping_add(1); 32],
            epochs: vec![EpochKeys::derive(&cid, 0, &[seed.wrapping_add(2); 32])],
            counter: 0,
        }
    }

    pub fn epoch(&self) -> &EpochKeys {
        self.epochs.last().unwrap()
    }

    pub fn next_id(&mut self) -> [u8; 16] {
        self.counter += 1;
        let mut id = [0u8; 16];
        id[0] = self.counter;
        id[1] = self.crk[0];
        id
    }

    pub fn op_with(
        &mut self,
        epoch: u32,
        author: [u8; 32],
        op_type: &str,
        body: Value,
        control: Option<([u8; 32], &str, Value)>,
    ) -> OpEnvelope {
        let op_id = self.next_id();
        let k = self.epochs.iter().find(|k| k.epoch == epoch).unwrap();
        seal_op(SealOp {
            cid: self.cid,
            op_id,
            epoch,
            op_key: &k.op_key,
            eak_seed: &k.eak_seed,
            author_seed: &author,
            base: 0,
            ts: 0,
            op_type,
            body,
            control: control
                .as_ref()
                .map(|(s, kind, args)| (s, *kind, args.clone())),
            nonce: [self.counter; 24],
        })
        .unwrap()
    }

    pub fn genesis(&mut self) -> OpEnvelope {
        let args = Value::map([
            ("suite", Value::Text("VV1".into())),
            ("crk", b(&public_key(&self.crk))),
            ("admins", Value::Array(vec![b(&public_key(&self.admin))])),
            ("eak", b(&self.epoch().eak_pk)),
            ("ik", b(&[7u8; 32])),
        ]);
        let admin = self.admin;
        let crk = self.crk;
        self.op_with(
            0,
            admin,
            "community.init",
            Value::map([("name", Value::Text("x".into()))]),
            Some((crk, "genesis", args)),
        )
    }

    pub fn data(&mut self, author: [u8; 32]) -> OpEnvelope {
        let e = self.epoch().epoch;
        self.op_with(
            e,
            author,
            "member.profile",
            Value::map([("n", Value::Int(self.counter as i64))]),
            None,
        )
    }

    /// A rotate op signed by `signer`; also records the new epoch keys locally.
    pub fn rotate(&mut self, signer: [u8; 32]) -> OpEnvelope {
        let cur = self.epoch().epoch;
        let next = EpochKeys::derive(&self.cid, cur + 1, &[100 + cur as u8; 32]);
        let args = Value::map([
            ("new_epoch", Value::Int(next.epoch as i64)),
            ("eak", b(&next.eak_pk)),
        ]);
        let env = self.op_with(
            cur,
            signer,
            "epoch.rotate",
            Value::Map(vec![]),
            Some((signer, "rotate", args)),
        );
        self.epochs.push(next);
        env
    }

    pub fn admin_set(&mut self, signer: [u8; 32], admins: &[[u8; 32]]) -> OpEnvelope {
        let cur = self.epoch().epoch;
        let args = Value::map([(
            "admins",
            Value::Array(admins.iter().map(|a| b(&public_key(a))).collect()),
        )]);
        self.op_with(
            cur,
            signer,
            "admin.set",
            Value::Map(vec![]),
            Some((signer, "admin.set", args)),
        )
    }
}

impl Fixture {
    /// A `migrate` control op (§11.3) signed by `signer`.
    pub fn migrate(&mut self, signer: [u8; 32], nodes: &[&str]) -> OpEnvelope {
        let cur = self.epoch().epoch;
        let args = Value::map([(
            "nodes",
            Value::Array(nodes.iter().map(|n| Value::Text((*n).into())).collect()),
        )]);
        self.op_with(
            cur,
            signer,
            "community.migrate",
            Value::Map(vec![]),
            Some((signer, "migrate", args)),
        )
    }
}

pub fn node_with(config: Config) -> Arc<App> {
    Arc::new(App::new(config, Store::open_in_memory().unwrap()).unwrap())
}

/// A call to the operator API (its own router), returning status and body text.
pub async fn operator(
    app: &Arc<App>,
    method: &str,
    uri: &str,
    token: Option<&str>,
) -> (StatusCode, Vec<u8>) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"));
    }
    let res = community_node::operator_service(app.clone())
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    (
        status,
        res.into_body().collect().await.unwrap().to_bytes().to_vec(),
    )
}

/// An operator API call with a JSON body.
pub async fn operator_json(
    app: &Arc<App>,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"));
    }
    let res = community_node::operator_service(app.clone())
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

pub async fn call(
    app: &Arc<App>,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    call_raw(app, method, uri, token, body.map(|v| cbor::encode(&v)), &[]).await
}

pub async fn call_raw(
    app: &Arc<App>,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Vec<u8>>,
    headers: &[(&str, &str)],
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"));
    }
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let req = req
        .body(body.map(Body::from).unwrap_or_else(Body::empty))
        .unwrap();
    let res = service(app.clone()).oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let value =
        cbor::decode(&bytes).unwrap_or(Value::Text(String::from_utf8_lossy(&bytes).into_owned()));
    (status, value)
}

/// Like `call_raw`, but returns the response body untouched plus its
/// `content-type`, for endpoints that answer with raw bytes (blobs).
pub async fn call_bytes(
    app: &Arc<App>,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Vec<u8>>,
    headers: &[(&str, &str)],
) -> (StatusCode, Option<String>, Vec<u8>) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"));
    }
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let req = req
        .body(body.map(Body::from).unwrap_or_else(Body::empty))
        .unwrap();
    let res = service(app.clone()).oneshot(req).await.unwrap();
    let status = res.status();
    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, content_type, bytes.to_vec())
}

pub async fn create(app: &Arc<App>, f: &mut Fixture) -> (StatusCode, Value) {
    let g = f.genesis();
    call_raw(
        app,
        "POST",
        "/v1/communities",
        None,
        Some(cbor::encode(&Value::map([("genesis", g.to_value())]))),
        &[("x-vv-provision-token", TOKEN)],
    )
    .await
}

/// Challenge/response login (§3.1). Returns the token, or the error status.
pub async fn login(
    app: &Arc<App>,
    cid: &[u8; 32],
    seed: &[u8; 32],
    scope: &str,
) -> Result<String, StatusCode> {
    let (s, ch) = call(
        app,
        "POST",
        "/v1/auth/challenge",
        None,
        Some(Value::map([("community_id", b(cid))])),
    )
    .await;
    if s != StatusCode::OK {
        return Err(s);
    }
    let nonce = ch.get("nonce").unwrap().as_bytes().unwrap().to_vec();
    let node_id = ch.get("node_id").unwrap().as_bytes().unwrap().to_vec();
    let signed = Value::map([
        ("community_id", b(cid)),
        ("node_id", b(&node_id)),
        ("nonce", b(&nonce)),
        ("scope", Value::Text(scope.into())),
    ]);
    let sig = sign(seed, ctx::AUTH, &cbor::encode(&signed));
    let (s, res) = call(
        app,
        "POST",
        "/v1/auth/session",
        None,
        Some(Value::map([
            ("community_id", b(cid)),
            ("nonce", b(&nonce)),
            ("scope", Value::Text(scope.into())),
            ("public_key", b(&public_key(seed))),
            ("sig", b(&sig)),
        ])),
    )
    .await;
    if s != StatusCode::OK {
        return Err(s);
    }
    Ok(res.get("token").unwrap().as_text().unwrap().to_owned())
}

pub async fn submit(
    app: &Arc<App>,
    cid: &[u8; 32],
    token: &str,
    ops: Vec<OpEnvelope>,
) -> (StatusCode, Value) {
    let body = Value::map([(
        "ops",
        Value::Array(ops.iter().map(|o| o.to_value()).collect()),
    )]);
    call(
        app,
        "POST",
        &format!("/v1/c/{}/ops", hex(cid)),
        Some(token),
        Some(body),
    )
    .await
}

/// The per-op result for a single-op submit: Ok(seq) or Err(error code).
pub fn first_result(v: &Value) -> Result<u64, String> {
    let Value::Array(r) = v.get("results").unwrap() else {
        panic!("results")
    };
    let r = &r[0];
    match r.get("seq") {
        Some(s) => Ok(s.as_uint().unwrap()),
        None => Err(r.get("error").unwrap().as_text().unwrap().to_owned()),
    }
}
