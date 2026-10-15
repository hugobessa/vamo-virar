//! Content-free push (protocol.md §14). When a mailbox receives something
//! worth opening the app for, the node asks the configured gateway to wake
//! the device registered for that mailbox. The push says only that there is
//! something new; the app then syncs and reads the log itself.
//!
//! The gateway speaks Expo's push API (`POST <gateway>` with a JSON array of
//! `{to, title, body, …}`), which is what the official app's tokens are for.
//! A fork with its own credentials points `push_gateway` at its own server.

use std::sync::Arc;

use crate::app::{hex, App};
use crate::store::{self, Cid};

/// Mailbox items that mean "someone did something for you": wake-ups from
/// other devices, organizers asking who can come, and a join decision; plus
/// `intake`, a new join request, sent to admins and moderators. Key
/// envelopes and the rest arrive on their own when the app next syncs.
pub const PUSH_KINDS: &[&str] = &["ping", "probe", "join_result", "intake"];

/// What the person sees. Deliberately the same for everything: the node
/// does not know more, and the lock screen should not say more.
const TITLE: &str = "Vamo Virar";
const BODY: &str = "Você tem novidades. Abra o app para ver.";

/// Called after a mailbox item is stored. Returns at once; the gateway call
/// runs in the background and never fails the request that caused it.
pub fn wake(app: &Arc<App>, cid: Cid, mbx: [u8; 32], kind: &str) {
    if !PUSH_KINDS.contains(&kind) || app.config.push_gateway.is_none() {
        return;
    }
    let token = match store::push_token(app.store.lock().unwrap().conn(), &cid, &mbx) {
        Ok(Some(t)) => t,
        Ok(None) => return,
        Err(e) => {
            tracing::warn!(error = %e, "push token lookup failed");
            return;
        }
    };
    // One push per window: a second mention a moment later rides on the first.
    let now = app.clock.now();
    {
        let mut at = app.pushed_at.lock().unwrap();
        if at
            .get(&(cid, mbx))
            .is_some_and(|t| now.saturating_sub(*t) < app.config.push_min_interval_secs * 1000)
        {
            return;
        }
        at.insert((cid, mbx), now);
    }
    let app = app.clone();
    tokio::spawn(async move { send(app, cid, mbx, token).await });
}

async fn send(app: Arc<App>, cid: Cid, mbx: [u8; 32], token: String) {
    let gateway = app.config.push_gateway.clone().expect("checked by wake");
    let message = serde_json::json!([{
        "to": token,
        "title": TITLE,
        "body": BODY,
        "sound": "default",
        "priority": "high",
        "channelId": "default",
    }]);
    let mut req = app.http.post(&gateway).json(&message);
    if let Some(t) = &app.config.push_access_token {
        req = req.bearer_auth(t);
    }
    let res = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "push gateway unreachable");
            return;
        }
    };
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        tracing::warn!(%status, "push gateway refused the wake-up");
        return;
    }
    // A ticket error means the token is dead: forget it until the device registers again.
    let dead = body["data"]
        .as_array()
        .and_then(|d| d.first())
        .map(|t| t["details"]["error"] == "DeviceNotRegistered")
        .unwrap_or(false);
    if dead {
        let st = app.store.lock().unwrap();
        if let Err(e) = store::delete_push_token(st.conn(), &cid, &mbx, Some(&token)) {
            tracing::warn!(error = %e, "could not drop a dead push token");
        } else {
            tracing::info!(cid = %hex(&cid), "dropped a push token the gateway no longer knows");
        }
    }
}
