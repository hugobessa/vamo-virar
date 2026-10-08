//! The node-side checks of protocol.md §4.1 and §5, and log sequencing.
//!
//! This is the only place the node makes decisions about operations, and it
//! decides only what it can verify without keys: access signatures, control
//! signatures, the admin set and epoch transitions. Domain validity is the
//! devices' business (§8).

use rusqlite::Connection;
use vv_crypto::cbor;
use vv_crypto::envelope::{ControlArgs, LogEntry, OpEnvelope, Plane};
use vv_crypto::keys::community_id;
use vv_crypto::primitives::hash_ctx;

use crate::store::{self, Cid, Community};

#[derive(Debug, PartialEq, Eq)]
pub enum Reject {
    NotHosted,
    Unauthorized(&'static str),
    EpochStale,
    EpochConflict,
    OpConflict,
    AlreadyExists,
}

impl Reject {
    pub fn code(&self) -> &'static str {
        match self {
            Reject::NotHosted => "not_hosted",
            Reject::Unauthorized(_) => "unauthorized",
            Reject::EpochStale => "epoch_stale",
            Reject::EpochConflict => "epoch_conflict",
            Reject::OpConflict => "op_conflict",
            Reject::AlreadyExists => "already_exists",
        }
    }
}

pub type Outcome<T> = Result<T, SeqError>;

#[derive(Debug)]
pub enum SeqError {
    Reject(Reject),
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for SeqError {
    fn from(e: rusqlite::Error) -> Self {
        SeqError::Db(e)
    }
}

impl From<Reject> for SeqError {
    fn from(r: Reject) -> Self {
        SeqError::Reject(r)
    }
}

fn env_hash(env: &OpEnvelope) -> [u8; 32] {
    hash_ctx("vv/node-env/v1", &[&env.encode()])
}

/// Appends an accepted envelope. `at` is monotonic per community.
fn append(c: &Connection, cm: &mut Community, env: OpEnvelope, now: u64) -> Outcome<u64> {
    let at = now.max(cm.head_at);
    let entry = LogEntry {
        seq: cm.head_seq + 1,
        prev: cm.head_hash,
        env,
        at,
    };
    let plane = if entry.env.plane == Plane::Control {
        "c"
    } else {
        "d"
    };
    store::insert_entry(
        c,
        &cm.cid,
        entry.seq,
        plane,
        &cbor::encode(&entry.to_value()),
        &entry.env.op_id,
        &env_hash(&entry.env),
    )?;
    cm.head_seq = entry.seq;
    cm.head_hash = entry.hash();
    cm.head_at = at;
    store::update_community(c, cm)?;
    Ok(entry.seq)
}

/// Creates a community from its genesis envelope (seq 1).
pub fn create(c: &Connection, env: OpEnvelope, now: u64) -> Outcome<(Cid, u64)> {
    let Some(ctrl) = &env.ctrl else {
        return Err(Reject::Unauthorized("not a genesis op").into());
    };
    let ControlArgs::Genesis {
        crk, admins, eak, ..
    } = &ctrl.args
    else {
        return Err(Reject::Unauthorized("not a genesis op").into());
    };
    if ctrl.signer != *crk || community_id(crk) != env.cid {
        return Err(
            Reject::Unauthorized("genesis must be signed by the CRK of this community").into(),
        );
    }
    if env.epoch != 0 || !env.verify_control() || !env.verify_access(eak) {
        return Err(Reject::Unauthorized("bad genesis signatures").into());
    }
    if store::community(c, &env.cid)?.is_some() {
        return Err(Reject::AlreadyExists.into());
    }
    let mut cm = Community {
        cid: env.cid,
        crk: *crk,
        epoch: 0,
        rotated_at: now,
        admin_set: admins.clone(),
        head_seq: 0,
        head_hash: [0; 32],
        head_at: 0,
        compacted_through: 0,
        intake_mode: "open".into(),
    };
    store::insert_community(c, &cm, now)?;
    store::insert_eak(c, &cm.cid, 0, eak)?;
    let seq = append(c, &mut cm, env, now)?;
    Ok((cm.cid, seq))
}

/// Validates and sequences one envelope for an existing community.
/// Idempotent: a known `op_id` with identical bytes returns its seq.
pub fn submit(c: &Connection, env: OpEnvelope, now: u64, epoch_grace_ms: u64) -> Outcome<u64> {
    let mut cm = store::community(c, &env.cid)?.ok_or(Reject::NotHosted)?;

    if let Some((seq, hash)) = store::op_id(c, &cm.cid, &env.op_id)? {
        return if hash == env_hash(&env) {
            Ok(seq)
        } else {
            Err(Reject::OpConflict.into())
        };
    }

    let in_grace = now.saturating_sub(cm.rotated_at) < epoch_grace_ms;
    let prev_epoch_ok =
        env.plane == Plane::Data && cm.epoch > 0 && env.epoch == cm.epoch - 1 && in_grace;
    if env.epoch != cm.epoch && !prev_epoch_ok {
        // A rotation written against an epoch someone else already rotated
        // away from lost a race (§7.5); say so, so the admin re-syncs and retries.
        let lost_rotation = env.epoch < cm.epoch
            && matches!(
                env.ctrl.as_ref().map(|c| &c.args),
                Some(ControlArgs::Rotate { .. })
            );
        return Err(if lost_rotation {
            Reject::EpochConflict
        } else {
            Reject::EpochStale
        }
        .into());
    }
    let eak = store::eak(c, &cm.cid, env.epoch)?.ok_or(Reject::EpochStale)?;
    if !env.verify_access(&eak) {
        return Err(Reject::Unauthorized("bad access signature").into());
    }

    if let Some(ctrl) = &env.ctrl {
        if !env.verify_control() {
            return Err(Reject::Unauthorized("bad control signature").into());
        }
        let is_admin = cm.admin_set.contains(&ctrl.signer);
        match &ctrl.args {
            ControlArgs::Genesis { .. } => {
                return Err(Reject::Unauthorized("genesis after seq 1").into())
            }
            ControlArgs::Rotate { new_epoch, eak } => {
                if !is_admin {
                    return Err(Reject::Unauthorized("rotate must be signed by an admin").into());
                }
                if *new_epoch != cm.epoch + 1 {
                    return Err(Reject::EpochConflict.into());
                }
                cm.epoch = *new_epoch;
                cm.rotated_at = now;
                store::insert_eak(c, &cm.cid, cm.epoch, eak)?;
            }
            ControlArgs::AdminSet { admins, .. } => {
                if !is_admin && ctrl.signer != cm.crk {
                    return Err(Reject::Unauthorized(
                        "admin.set must be signed by an admin or the CRK",
                    )
                    .into());
                }
                cm.admin_set = admins.clone();
            }
        }
    }
    append(c, &mut cm, env, now)
}

/// Rebuilds a community on this node from data held by an admin device
/// (protocol.md §11.3): every control-plane entry, optionally the latest
/// snapshot, and the log tail after it. All signatures are re-verified and
/// the tail must hash-chain from the snapshot (or from genesis).
pub fn restore(
    c: &Connection,
    control_chain: Vec<LogEntry>,
    snapshot: Option<vv_crypto::snapshot::SnapshotEnvelope>,
    tail: Vec<LogEntry>,
    now: u64,
) -> Outcome<(Cid, u64)> {
    let bad = |why| SeqError::Reject(Reject::Unauthorized(why));
    let genesis = control_chain.first().ok_or(bad("empty control chain"))?;
    if genesis.seq != 1 || genesis.prev != [0; 32] {
        return Err(bad("control chain must start at genesis"));
    }
    let Some(ctrl) = &genesis.env.ctrl else {
        return Err(bad("seq 1 is not genesis"));
    };
    let ControlArgs::Genesis {
        crk, admins, eak, ..
    } = &ctrl.args
    else {
        return Err(bad("seq 1 is not genesis"));
    };
    let cid = genesis.env.cid;
    if ctrl.signer != *crk
        || community_id(crk) != cid
        || !genesis.env.verify_control()
        || !genesis.env.verify_access(eak)
    {
        return Err(bad("bad genesis"));
    }
    if store::community(c, &cid)?.is_some() {
        return Err(Reject::AlreadyExists.into());
    }

    let tail_start = tail.first().map(|e| e.seq);
    let snap_seq = snapshot.as_ref().map(|s| s.seq).unwrap_or(1);
    if tail_start.is_some_and(|t| t != snap_seq + 1) {
        return Err(bad("tail must start right after the snapshot"));
    }

    // Walk control entries up to the snapshot, then the tail, in seq order,
    // re-applying exactly the checks `submit` makes.
    let mut epoch = 0u32;
    let mut admin_set = admins.clone();
    let mut eaks = vec![(0u32, *eak)];
    let mut rotated_at = genesis.at;
    let eak_of =
        |eaks: &Vec<(u32, [u8; 32])>, e: u32| eaks.iter().find(|(n, _)| *n == e).map(|(_, k)| *k);

    let mut ordered: Vec<&LogEntry> = control_chain
        .iter()
        .skip(1)
        .filter(|e| e.seq <= snap_seq)
        .collect();
    ordered.extend(tail.iter());
    let mut last_seq = 1;
    for e in &ordered {
        if e.seq <= last_seq || e.env.cid != cid {
            return Err(bad("entries out of order or for another community"));
        }
        last_seq = e.seq;
        let key = eak_of(&eaks, e.env.epoch).ok_or(bad("entry under an unknown epoch"))?;
        if !e.env.verify_access(&key) {
            return Err(bad("bad access signature in restore"));
        }
        if let Some(ctrl) = &e.env.ctrl {
            if !e.env.verify_control() {
                return Err(bad("bad control signature in restore"));
            }
            match &ctrl.args {
                ControlArgs::Genesis { .. } => return Err(bad("second genesis")),
                ControlArgs::Rotate { new_epoch, eak } => {
                    if !admin_set.contains(&ctrl.signer)
                        || *new_epoch != epoch + 1
                        || e.env.epoch != epoch
                    {
                        return Err(bad("invalid rotation in restore"));
                    }
                    epoch = *new_epoch;
                    rotated_at = e.at;
                    eaks.push((epoch, *eak));
                }
                ControlArgs::AdminSet { admins, .. } => {
                    if !admin_set.contains(&ctrl.signer) && ctrl.signer != *crk {
                        return Err(bad("invalid admin.set in restore"));
                    }
                    admin_set = admins.clone();
                }
            }
        }
    }

    // Hash chain: the tail links from the snapshot head (or genesis).
    let mut prev = match &snapshot {
        Some(s) => s.head,
        None => genesis.hash(),
    };
    for (expect_seq, e) in (snap_seq + 1..).zip(&tail) {
        if e.seq != expect_seq || e.prev != prev {
            return Err(bad("tail does not hash-chain"));
        }
        prev = e.hash();
    }
    if let Some(s) = &snapshot {
        let key = eak_of(&eaks, s.epoch).ok_or(bad("snapshot under an unknown epoch"))?;
        if s.cid != cid || !s.verify_access(&key) {
            return Err(bad("bad snapshot"));
        }
    }

    let head = tail.last().map(|e| (e.seq, e.hash(), e.at));
    let (head_seq, head_hash, head_at) = match (head, &snapshot) {
        (Some(h), _) => h,
        (None, Some(s)) => (s.seq, s.head, genesis.at),
        (None, None) => (1, genesis.hash(), genesis.at),
    };
    let cm = Community {
        cid,
        crk: *crk,
        epoch,
        rotated_at,
        admin_set,
        head_seq,
        head_hash,
        head_at,
        compacted_through: if snapshot.is_some() { snap_seq } else { 0 },
        intake_mode: "open".into(),
    };
    store::insert_community(c, &cm, now)?;
    for (n, k) in &eaks {
        store::insert_eak(c, &cid, *n, k)?;
    }
    let mut kept: Vec<&LogEntry> = control_chain.iter().filter(|e| e.seq <= snap_seq).collect();
    kept.extend(tail.iter());
    for e in kept {
        let plane = if e.env.plane == Plane::Control {
            "c"
        } else {
            "d"
        };
        store::insert_entry(
            c,
            &cid,
            e.seq,
            plane,
            &cbor::encode(&e.to_value()),
            &e.env.op_id,
            &env_hash(&e.env),
        )?;
    }
    if let Some(s) = snapshot {
        c.execute(
            "INSERT INTO snapshots (cid, seq, env, stored_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![cid, s.seq, s.encode(), now],
        )?;
    }
    Ok((cid, head_seq))
}
