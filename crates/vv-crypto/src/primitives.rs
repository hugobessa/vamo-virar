//! VV1 primitives (protocol.md §1.3) and context framing (§1.2).

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use hkdf::Hkdf;
use hpke::aead::ChaCha20Poly1305 as HpkeChaCha;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem, OpModeR};
use sha2::{Digest, Sha256};

/// Signature framing: ctx_len (1 byte) || ctx || cbor(value).
pub fn frame(ctx: &str, cbor: &[u8]) -> Vec<u8> {
    assert!(ctx.len() <= 255, "context too long");
    let mut out = Vec::with_capacity(1 + ctx.len() + cbor.len());
    out.push(ctx.len() as u8);
    out.extend_from_slice(ctx.as_bytes());
    out.extend_from_slice(cbor);
    out
}

/// SHA-256(ctx || parts…), used for identifiers and digests.
pub fn hash_ctx(ctx: &str, parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(ctx.as_bytes());
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

pub fn public_key(seed: &[u8; 32]) -> [u8; 32] {
    SigningKey::from_bytes(seed).verifying_key().to_bytes()
}

pub fn sign(seed: &[u8; 32], ctx: &str, cbor: &[u8]) -> [u8; 64] {
    SigningKey::from_bytes(seed)
        .sign(&frame(ctx, cbor))
        .to_bytes()
}

/// Strict verification: canonical encodings, s < L, no small-order A or R.
pub fn verify(pk: &[u8], ctx: &str, cbor: &[u8], sig: &[u8]) -> bool {
    let (Ok(pk), Ok(sig)) = (<[u8; 32]>::try_from(pk), <[u8; 64]>::try_from(sig)) else {
        return false;
    };
    let Ok(vk) = VerifyingKey::from_bytes(&pk) else {
        return false;
    };
    vk.verify_strict(&frame(ctx, cbor), &Signature::from_bytes(&sig))
        .is_ok()
}

pub fn hkdf(ikm: &[u8], salt: &[u8], info: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(Some(salt), ikm)
        .expand(info, &mut out)
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    out
}

/// XChaCha20-Poly1305 open; None on authentication failure.
pub fn aead_open(key: &[u8; 32], nonce: &[u8], ct: &[u8], aad: &[u8]) -> Option<Vec<u8>> {
    if nonce.len() != 24 {
        return None;
    }
    XChaCha20Poly1305::new(key.into())
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad })
        .ok()
}

pub fn aead_seal(key: &[u8; 32], nonce: &[u8; 24], pt: &[u8], aad: &[u8]) -> Vec<u8> {
    XChaCha20Poly1305::new(key.into())
        .encrypt(XNonce::from_slice(nonce), Payload { msg: pt, aad })
        .expect("encryption with a valid key cannot fail")
}

/// HPKE base-mode single-shot open, suite DHKEM(X25519)/HKDF-SHA256/ChaCha20Poly1305.
pub fn hpke_open(sk: &[u8], enc: &[u8], info: &[u8], aad: &[u8], ct: &[u8]) -> Option<Vec<u8>> {
    let sk = <X25519HkdfSha256 as Kem>::PrivateKey::from_bytes(sk).ok()?;
    let enc = <X25519HkdfSha256 as Kem>::EncappedKey::from_bytes(enc).ok()?;
    hpke::single_shot_open::<HpkeChaCha, HkdfSha256, X25519HkdfSha256>(
        &OpModeR::Base,
        &sk,
        &enc,
        info,
        ct,
        aad,
    )
    .ok()
}
