//! The vamo-virar community node: a sequencer, encrypted mailbox and
//! snapshot store for one or more communities (docs/protocol.md). It holds
//! no keys that can read community content.

pub mod api;
pub mod app;
pub mod operator;
pub mod push;
pub mod sequencer;
pub mod store;

use std::sync::Arc;

pub use app::{App, Config};

/// Builds the full HTTP application for `app`.
pub fn service(app: Arc<App>) -> axum::Router {
    api::router(app)
        .layer(api::body_limit())
        .layer(axum::middleware::from_fn(api::cors))
}

/// The operator API (managed hosting), for its own listener.
pub fn operator_service(app: Arc<App>) -> axum::Router {
    operator::router(app).layer(api::body_limit())
}
