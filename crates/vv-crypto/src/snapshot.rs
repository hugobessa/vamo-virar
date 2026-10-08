//! Snapshot envelopes (protocol.md §12.1): what the node stores and checks.
//! The node cannot decrypt a snapshot; it verifies `asig` under the epoch's
//! access key and that `head` is the hash of log entry `seq`.

use crate::cbor::{self, Value};
use crate::ctx;
use crate::envelope::WireError;
use crate::primitives::verify;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotEnvelope {
    pub cid: [u8; 32],
    pub seq: u64,
    pub head: [u8; 32],
    pub epoch: u32,
    pub nonce: [u8; 24],
    pub ct: Vec<u8>,
    pub asig: [u8; 64],
}

fn fixed<const N: usize>(v: Option<&Value>, what: &'static str) -> Result<[u8; N], WireError> {
    v.and_then(Value::as_bytes)
        .and_then(|b| <[u8; N]>::try_from(b).ok())
        .ok_or(WireError::Malformed(what))
}

impl SnapshotEnvelope {
    pub fn from_value(v: &Value) -> Result<Self, WireError> {
        let Value::Map(m) = v else {
            return Err(WireError::Malformed("snapshot"));
        };
        let allowed = ["cid", "seq", "head", "epoch", "nonce", "ct", "asig"];
        if m.iter().any(|(k, _)| !allowed.contains(&k.as_str())) {
            return Err(WireError::Malformed("snapshot field"));
        }
        let epoch = v
            .get("epoch")
            .and_then(Value::as_uint)
            .filter(|e| *e <= u32::MAX as u64)
            .ok_or(WireError::Malformed("epoch"))?;
        Ok(SnapshotEnvelope {
            cid: fixed(v.get("cid"), "cid")?,
            seq: v
                .get("seq")
                .and_then(Value::as_uint)
                .ok_or(WireError::Malformed("seq"))?,
            head: fixed(v.get("head"), "head")?,
            epoch: epoch as u32,
            nonce: fixed(v.get("nonce"), "nonce")?,
            ct: v
                .get("ct")
                .and_then(Value::as_bytes)
                .ok_or(WireError::Malformed("ct"))?
                .to_vec(),
            asig: fixed(v.get("asig"), "asig")?,
        })
    }

    pub fn decode(raw: &[u8]) -> Result<Self, WireError> {
        Self::from_value(&cbor::decode(raw)?)
    }

    fn header(&self) -> Vec<(&'static str, Value)> {
        vec![
            ("cid", Value::Bytes(self.cid.to_vec())),
            ("seq", Value::Int(self.seq as i64)),
            ("head", Value::Bytes(self.head.to_vec())),
            ("epoch", Value::Int(self.epoch as i64)),
        ]
    }

    pub fn to_value(&self) -> Value {
        let mut e = self.header();
        e.push(("nonce", Value::Bytes(self.nonce.to_vec())));
        e.push(("ct", Value::Bytes(self.ct.clone())));
        e.push(("asig", Value::Bytes(self.asig.to_vec())));
        Value::map(e)
    }

    pub fn encode(&self) -> Vec<u8> {
        cbor::encode(&self.to_value())
    }

    pub fn verify_access(&self, eak: &[u8; 32]) -> bool {
        let mut e = self.header();
        e.push(("nonce", Value::Bytes(self.nonce.to_vec())));
        e.push(("ct", Value::Bytes(self.ct.clone())));
        verify(
            eak,
            ctx::SNAPSHOT_ACCESS,
            &cbor::encode(&Value::map(e)),
            &self.asig,
        )
    }
}
