//! The VV1 cryptographic suite and protocol envelopes for the Rust side of
//! vamo-virar (the community node). Byte-compatible with
//! `packages/crypto` and `packages/protocol`; `tests/vectors.rs` checks this
//! against the shared vectors in `tests/vectors/vv1.json`.

pub mod cbor;
pub mod ctx;
pub mod envelope;
pub mod keys;
pub mod primitives;
pub mod snapshot;
