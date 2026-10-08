//! Operation envelopes, control headers, log entries and key envelopes
//! (protocol.md §4, §5, §7.1): everything the node checks, plus device-side
//! opening for parity with the TypeScript implementation.

use thiserror::Error;

use crate::cbor::{self, CborError, Value};
use crate::ctx;
use crate::primitives::{aead_open, hash_ctx, hpke_open, verify};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WireError {
    #[error("cbor: {0}")]
    Cbor(#[from] CborError),
    #[error("malformed {0}")]
    Malformed(&'static str),
}

type Result<T> = std::result::Result<T, WireError>;

const MAX_ADMINS: usize = 64;

fn map_fields<'a>(
    v: &'a Value,
    allowed: &[&str],
    what: &'static str,
) -> Result<&'a [(String, Value)]> {
    let Value::Map(m) = v else {
        return Err(WireError::Malformed(what));
    };
    if m.iter().any(|(k, _)| !allowed.contains(&k.as_str())) {
        return Err(WireError::Malformed(what));
    }
    Ok(m)
}

fn bytes<const N: usize>(v: Option<&Value>, what: &'static str) -> Result<[u8; N]> {
    v.and_then(Value::as_bytes)
        .and_then(|b| <[u8; N]>::try_from(b).ok())
        .ok_or(WireError::Malformed(what))
}

fn uint(v: Option<&Value>, max: u64, what: &'static str) -> Result<u64> {
    v.and_then(Value::as_uint)
        .filter(|n| *n <= max)
        .ok_or(WireError::Malformed(what))
}

fn key_list(v: Option<&Value>) -> Result<Vec<[u8; 32]>> {
    let Some(Value::Array(items)) = v else {
        return Err(WireError::Malformed("key list"));
    };
    if items.is_empty() || items.len() > MAX_ADMINS {
        return Err(WireError::Malformed("key list"));
    }
    items.iter().map(|k| bytes::<32>(Some(k), "key")).collect()
}

// ---------------------------------------------------------------------------
// Control headers
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ControlArgs {
    Genesis {
        crk: [u8; 32],
        admins: Vec<[u8; 32]>,
        eak: [u8; 32],
        ik: [u8; 32],
    },
    Rotate {
        new_epoch: u32,
        eak: [u8; 32],
    },
    AdminSet {
        admins: Vec<[u8; 32]>,
        ik: Option<[u8; 32]>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ControlHeader {
    pub kind: String,
    pub signer: [u8; 32],
    pub csig: [u8; 64],
    /// As received; strict decoding guarantees it re-encodes byte-identically.
    pub args_value: Value,
    pub args: ControlArgs,
}

impl ControlHeader {
    fn from_value(v: &Value) -> Result<Self> {
        map_fields(v, &["kind", "signer", "csig", "args"], "ctrl")?;
        let kind = v
            .get("kind")
            .and_then(Value::as_text)
            .ok_or(WireError::Malformed("ctrl kind"))?;
        let a = v.get("args").ok_or(WireError::Malformed("ctrl args"))?;
        let args = match kind {
            "genesis" => {
                map_fields(a, &["suite", "crk", "admins", "eak", "ik"], "genesis args")?;
                if a.get("suite").and_then(Value::as_text) != Some("VV1") {
                    return Err(WireError::Malformed("suite"));
                }
                ControlArgs::Genesis {
                    crk: bytes(a.get("crk"), "crk")?,
                    admins: key_list(a.get("admins"))?,
                    eak: bytes(a.get("eak"), "eak")?,
                    ik: bytes(a.get("ik"), "ik")?,
                }
            }
            "rotate" => {
                map_fields(a, &["new_epoch", "eak"], "rotate args")?;
                ControlArgs::Rotate {
                    new_epoch: uint(a.get("new_epoch"), u32::MAX as u64, "new_epoch")? as u32,
                    eak: bytes(a.get("eak"), "eak")?,
                }
            }
            "admin.set" => {
                map_fields(a, &["admins", "ik"], "admin.set args")?;
                ControlArgs::AdminSet {
                    admins: key_list(a.get("admins"))?,
                    ik: a.get("ik").map(|ik| bytes(Some(ik), "ik")).transpose()?,
                }
            }
            _ => return Err(WireError::Malformed("ctrl kind")),
        };
        Ok(ControlHeader {
            kind: kind.to_owned(),
            signer: bytes(v.get("signer"), "signer")?,
            csig: bytes(v.get("csig"), "csig")?,
            args_value: a.clone(),
            args,
        })
    }

    fn to_value(&self) -> Value {
        Value::map([
            ("kind", Value::Text(self.kind.clone())),
            ("signer", Value::Bytes(self.signer.to_vec())),
            ("csig", Value::Bytes(self.csig.to_vec())),
            ("args", self.args_value.clone()),
        ])
    }
}

// ---------------------------------------------------------------------------
// Op envelopes
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plane {
    Data,
    Control,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpEnvelope {
    pub cid: [u8; 32],
    pub op_id: [u8; 16],
    pub epoch: u32,
    pub plane: Plane,
    pub ctrl: Option<ControlHeader>,
    pub nonce: [u8; 24],
    pub ct: Vec<u8>,
    pub asig: [u8; 64],
}

#[derive(Debug, PartialEq, Eq)]
pub struct OpenedOp {
    pub author: [u8; 32],
    pub base: u64,
    pub ts: u64,
    pub op_type: String,
    pub body: Value,
}

#[derive(Debug, PartialEq, Eq)]
pub enum OpenProblem {
    Undecryptable,
    Malformed,
    BindingMismatch,
    BadSignature,
}

impl OpEnvelope {
    pub fn decode(raw: &[u8]) -> Result<Self> {
        if raw.len() > 64 * 1024 {
            return Err(WireError::Malformed("envelope too large"));
        }
        Self::from_value(&cbor::decode(raw)?)
    }

    pub fn from_value(v: &Value) -> Result<Self> {
        map_fields(
            v,
            &[
                "v", "cid", "op_id", "epoch", "plane", "ctrl", "nonce", "ct", "asig",
            ],
            "envelope",
        )?;
        if v.get("v") != Some(&Value::Int(1)) {
            return Err(WireError::Malformed("version"));
        }
        let plane = match v.get("plane").and_then(Value::as_text) {
            Some("d") => Plane::Data,
            Some("c") => Plane::Control,
            _ => return Err(WireError::Malformed("plane")),
        };
        let ctrl = v.get("ctrl").map(ControlHeader::from_value).transpose()?;
        if (plane == Plane::Control) != ctrl.is_some() {
            return Err(WireError::Malformed("ctrl must be present iff plane is c"));
        }
        Ok(OpEnvelope {
            cid: bytes(v.get("cid"), "cid")?,
            op_id: bytes(v.get("op_id"), "op_id")?,
            epoch: uint(v.get("epoch"), u32::MAX as u64, "epoch")? as u32,
            plane,
            ctrl,
            nonce: bytes(v.get("nonce"), "nonce")?,
            ct: v
                .get("ct")
                .and_then(Value::as_bytes)
                .ok_or(WireError::Malformed("ct"))?
                .to_vec(),
            asig: bytes(v.get("asig"), "asig")?,
        })
    }

    fn header_entries(&self) -> Vec<(&'static str, Value)> {
        let mut h = vec![
            ("v", Value::Int(1)),
            ("cid", Value::Bytes(self.cid.to_vec())),
            ("op_id", Value::Bytes(self.op_id.to_vec())),
            ("epoch", Value::Int(self.epoch as i64)),
            (
                "plane",
                Value::Text(if self.plane == Plane::Data { "d" } else { "c" }.into()),
            ),
        ];
        if let Some(c) = &self.ctrl {
            h.push(("ctrl", c.to_value()));
        }
        h
    }

    /// The AEAD associated data: cbor({v, cid, op_id, epoch, plane, ctrl?}).
    pub fn aad(&self) -> Vec<u8> {
        cbor::encode(&Value::map(self.header_entries()))
    }

    pub fn to_value(&self) -> Value {
        let mut e = self.header_entries();
        e.push(("nonce", Value::Bytes(self.nonce.to_vec())));
        e.push(("ct", Value::Bytes(self.ct.clone())));
        e.push(("asig", Value::Bytes(self.asig.to_vec())));
        Value::map(e)
    }

    pub fn encode(&self) -> Vec<u8> {
        cbor::encode(&self.to_value())
    }

    /// Node check §4.1 (2): signed by the epoch access key.
    pub fn verify_access(&self, eak: &[u8; 32]) -> bool {
        let mut e = self.header_entries();
        e.push(("nonce", Value::Bytes(self.nonce.to_vec())));
        e.push(("ct", Value::Bytes(self.ct.clone())));
        verify(
            eak,
            ctx::OP_ACCESS,
            &cbor::encode(&Value::map(e)),
            &self.asig,
        )
    }

    /// Node check §5: the control header is signed by its claimed signer.
    pub fn verify_control(&self) -> bool {
        let Some(c) = &self.ctrl else { return false };
        let signed = Value::map([
            ("cid", Value::Bytes(self.cid.to_vec())),
            ("op_id", Value::Bytes(self.op_id.to_vec())),
            ("epoch", Value::Int(self.epoch as i64)),
            ("kind", Value::Text(c.kind.clone())),
            ("args", c.args_value.clone()),
        ]);
        verify(&c.signer, ctx::CTRL_SIG, &cbor::encode(&signed), &c.csig)
    }

    /// Device side: decrypt with op_key and verify the inner signature and binding.
    pub fn open(&self, op_key: &[u8; 32]) -> std::result::Result<OpenedOp, OpenProblem> {
        let pt = aead_open(op_key, &self.nonce, &self.ct, &self.aad())
            .ok_or(OpenProblem::Undecryptable)?;
        let v = cbor::decode(&pt).map_err(|_| OpenProblem::Malformed)?;
        let fields = [
            "op_id", "cid", "epoch", "author", "base", "ts", "type", "body", "sig",
        ];
        let m = map_fields(&v, &fields, "signed op").map_err(|_| OpenProblem::Malformed)?;
        let author: [u8; 32] =
            bytes(v.get("author"), "author").map_err(|_| OpenProblem::Malformed)?;
        let sig: [u8; 64] = bytes(v.get("sig"), "sig").map_err(|_| OpenProblem::Malformed)?;
        let op_id: [u8; 16] = bytes(v.get("op_id"), "op_id").map_err(|_| OpenProblem::Malformed)?;
        let cid: [u8; 32] = bytes(v.get("cid"), "cid").map_err(|_| OpenProblem::Malformed)?;
        let epoch =
            uint(v.get("epoch"), u32::MAX as u64, "epoch").map_err(|_| OpenProblem::Malformed)?;
        let base = uint(v.get("base"), u64::MAX, "base").map_err(|_| OpenProblem::Malformed)?;
        let ts = uint(v.get("ts"), u64::MAX, "ts").map_err(|_| OpenProblem::Malformed)?;
        let op_type = v
            .get("type")
            .and_then(Value::as_text)
            .ok_or(OpenProblem::Malformed)?
            .to_owned();
        if op_id != self.op_id || cid != self.cid || epoch != self.epoch as u64 {
            return Err(OpenProblem::BindingMismatch);
        }
        // Every field is required: verifying over a defaulted field would let
        // implementations disagree about what was signed.
        let body = v.get("body").cloned().ok_or(OpenProblem::Malformed)?;
        let unsigned = Value::Map(m.iter().filter(|(k, _)| k != "sig").cloned().collect());
        if !verify(&author, ctx::OP_SIG, &cbor::encode(&unsigned), &sig) {
            return Err(OpenProblem::BadSignature);
        }
        Ok(OpenedOp {
            author,
            base,
            ts,
            op_type,
            body,
        })
    }
}

// ---------------------------------------------------------------------------
// Log entries
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogEntry {
    pub seq: u64,
    pub prev: [u8; 32],
    pub env: OpEnvelope,
    pub at: u64,
}

impl LogEntry {
    pub fn decode(raw: &[u8]) -> Result<Self> {
        let v = cbor::decode(raw)?;
        map_fields(&v, &["seq", "prev", "env", "at"], "log entry")?;
        Ok(LogEntry {
            seq: uint(v.get("seq"), u64::MAX, "seq")?,
            prev: bytes(v.get("prev"), "prev")?,
            env: OpEnvelope::from_value(v.get("env").ok_or(WireError::Malformed("env"))?)?,
            at: uint(v.get("at"), u64::MAX, "at")?,
        })
    }

    pub fn to_value(&self) -> Value {
        Value::map([
            ("seq", Value::Int(self.seq as i64)),
            ("prev", Value::Bytes(self.prev.to_vec())),
            ("env", self.env.to_value()),
            ("at", Value::Int(self.at as i64)),
        ])
    }

    /// entry_hash = SHA-256("vv/log-entry/v1" || cbor({seq, prev, env, at})).
    pub fn hash(&self) -> [u8; 32] {
        hash_ctx(ctx::LOG_ENTRY, &[&cbor::encode(&self.to_value())])
    }
}

// ---------------------------------------------------------------------------
// Key envelopes
// ---------------------------------------------------------------------------

/// Opens a key envelope (§7.1) with the recipient's X25519 secret; returns K_epoch.
pub fn open_key_envelope(raw: &[u8], recipient_sk: &[u8; 32]) -> Result<Option<[u8; 32]>> {
    let v = cbor::decode(raw)?;
    map_fields(
        &v,
        &["cid", "epoch", "recipient", "enc", "ct"],
        "key envelope",
    )?;
    let cid: [u8; 32] = bytes(v.get("cid"), "cid")?;
    let epoch = uint(v.get("epoch"), u32::MAX as u64, "epoch")? as u32;
    let recipient: [u8; 32] = bytes(v.get("recipient"), "recipient")?;
    let enc: [u8; 32] = bytes(v.get("enc"), "enc")?;
    let ct = v
        .get("ct")
        .and_then(Value::as_bytes)
        .ok_or(WireError::Malformed("ct"))?;

    let mut info = ctx::KEY_ENV.as_bytes().to_vec();
    info.extend_from_slice(&cid);
    info.extend_from_slice(&epoch.to_be_bytes());
    let aad = cbor::encode(&Value::map([
        ("cid", Value::Bytes(cid.to_vec())),
        ("epoch", Value::Int(epoch as i64)),
        ("recipient", Value::Bytes(recipient.to_vec())),
    ]));
    Ok(hpke_open(recipient_sk, &enc, &info, &aad, ct).and_then(|k| <[u8; 32]>::try_from(k).ok()))
}

// ---------------------------------------------------------------------------
// Sealing (used by Rust clients and node tests)
// ---------------------------------------------------------------------------

/// Inputs for [`seal_op`]. Byte-for-byte equivalent to `sealOp` in
/// packages/crypto given the same nonce.
pub struct SealOp<'a> {
    pub cid: [u8; 32],
    pub op_id: [u8; 16],
    pub epoch: u32,
    pub op_key: &'a [u8; 32],
    pub eak_seed: &'a [u8; 32],
    pub author_seed: &'a [u8; 32],
    pub base: u64,
    pub ts: u64,
    pub op_type: &'a str,
    pub body: Value,
    /// Control-plane ops: (signer seed, kind, args).
    pub control: Option<(&'a [u8; 32], &'a str, Value)>,
    pub nonce: [u8; 24],
}

pub fn seal_op(s: SealOp<'_>) -> Result<OpEnvelope> {
    use crate::primitives::{aead_seal, public_key, sign};

    let unsigned = Value::map([
        ("op_id", Value::Bytes(s.op_id.to_vec())),
        ("cid", Value::Bytes(s.cid.to_vec())),
        ("epoch", Value::Int(s.epoch as i64)),
        ("author", Value::Bytes(public_key(s.author_seed).to_vec())),
        ("base", Value::Int(s.base as i64)),
        ("ts", Value::Int(s.ts as i64)),
        ("type", Value::Text(s.op_type.to_owned())),
        ("body", s.body),
    ]);
    let sig = sign(s.author_seed, ctx::OP_SIG, &cbor::encode(&unsigned));
    let Value::Map(mut fields) = unsigned else {
        unreachable!()
    };
    fields.push(("sig".into(), Value::Bytes(sig.to_vec())));
    let plaintext = cbor::encode(&Value::Map(fields));

    let ctrl = match s.control {
        None => None,
        Some((signer_seed, kind, args)) => {
            let signed = Value::map([
                ("cid", Value::Bytes(s.cid.to_vec())),
                ("op_id", Value::Bytes(s.op_id.to_vec())),
                ("epoch", Value::Int(s.epoch as i64)),
                ("kind", Value::Text(kind.to_owned())),
                ("args", args.clone()),
            ]);
            let csig = sign(signer_seed, ctx::CTRL_SIG, &cbor::encode(&signed));
            let header = Value::map([
                ("kind", Value::Text(kind.to_owned())),
                ("signer", Value::Bytes(public_key(signer_seed).to_vec())),
                ("csig", Value::Bytes(csig.to_vec())),
                ("args", args),
            ]);
            // Round-trip through the strict decoder so args are validated and canonical.
            Some(ControlHeader::from_value(&cbor::decode(&cbor::encode(
                &header,
            ))?)?)
        }
    };

    let mut env = OpEnvelope {
        cid: s.cid,
        op_id: s.op_id,
        epoch: s.epoch,
        plane: if ctrl.is_some() {
            Plane::Control
        } else {
            Plane::Data
        },
        ctrl,
        nonce: s.nonce,
        ct: Vec::new(),
        asig: [0; 64],
    };
    env.ct = aead_seal(s.op_key, &s.nonce, &plaintext, &env.aad());
    let mut e = env.header_entries();
    e.push(("nonce", Value::Bytes(env.nonce.to_vec())));
    e.push(("ct", Value::Bytes(env.ct.clone())));
    env.asig = sign(s.eak_seed, ctx::OP_ACCESS, &cbor::encode(&Value::map(e)));
    Ok(env)
}
