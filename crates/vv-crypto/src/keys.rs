//! Identifiers and epoch key derivations (protocol.md §2.2, §2.3).

use crate::ctx;
use crate::primitives::{hash_ctx, hkdf, public_key};

pub fn community_id(crk: &[u8; 32]) -> [u8; 32] {
    hash_ctx(ctx::COMMUNITY_ID, &[crk])
}

pub fn member_id(msk: &[u8; 32]) -> [u8; 32] {
    hash_ctx(ctx::MEMBER_ID, &[msk])
}

pub fn mailbox_id(cid: &[u8; 32], msk: &[u8; 32]) -> [u8; 32] {
    hash_ctx(ctx::MAILBOX_ID, &[cid, msk])
}

/// Everything derived from K_e.
pub struct EpochKeys {
    pub epoch: u32,
    pub op_key: [u8; 32],
    pub snapshot_key: [u8; 32],
    pub eak_seed: [u8; 32],
    pub eak_pk: [u8; 32],
}

impl EpochKeys {
    pub fn derive(cid: &[u8; 32], epoch: u32, key: &[u8; 32]) -> EpochKeys {
        let mut salt = [0u8; 36];
        salt[..32].copy_from_slice(cid);
        salt[32..].copy_from_slice(&epoch.to_be_bytes());
        let eak_seed = hkdf(key, &salt, ctx::EPOCH_ACCESS.as_bytes());
        EpochKeys {
            epoch,
            op_key: hkdf(key, &salt, ctx::OP_KEY.as_bytes()),
            snapshot_key: hkdf(key, &salt, ctx::SNAPSHOT_KEY.as_bytes()),
            eak_pk: public_key(&eak_seed),
            eak_seed,
        }
    }
}
