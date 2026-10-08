# Security Engineering Rules

Implementation rules for both the TypeScript (`packages/crypto`) and Rust
(`crates/crypto`) code. The *what* is in [`protocol.md`](protocol.md) §1.3 and
§2; the *why* is in [`threat-model.md`](threat-model.md).

## Cryptography

- Use only the `VV1` suite primitives. Do not add algorithms without a
  protocol change.
- Libraries: TypeScript `@noble/curves`, `@noble/hashes`, `@noble/ciphers`,
  and an RFC 9180 HPKE implementation built on them; Rust `ed25519-dalek`
  (with `verify_strict`), `x25519-dalek`, `hpke`, `chacha20poly1305`, `sha2`,
  `hkdf`. Pin exact versions; review diffs on upgrade.
- No custom primitives. Composition only as specified. The one composed
  construction we implement ourselves, HPKE (RFC 9180) on top of the noble
  primitives (so React Native needs no WebCrypto), is tested for
  interoperability against hpke-js in both directions and against the Rust
  `hpke` crate via the shared vectors.
- Decoders are strict: CBOR that is not in deterministic form, unknown
  fields, or wrong lengths are rejected rather than tolerated.
- Every signature, KDF and AEAD use has a context string from protocol §15.
- Random values come from the platform CSPRNG only
  (`crypto.getRandomValues` via `react-native-get-random-values`; `OsRng` in
  Rust).
- Compare secrets and MACs in constant time.
- Both implementations must pass the same test vectors
  (`tests/vectors/vv1.json`) before either is merged. Regenerate with
  `VV_WRITE_VECTORS=1 npm run vectors -w @vamo-virar/crypto` only for an
  intentional wire change, and review the diff.

## Keys on devices

- Private keys and epoch keys live in the iOS Keychain / Android Keystore
  (wrapped), never in plaintext SQLite, logs, crash reports or analytics.
- The local SQLite database is encrypted at rest (SQLCipher) with a key held
  in the keystore.
- Wipe decrypted plaintext buffers when practical; never cache plaintext
  outside the encrypted database.

## Node

- The node never receives private keys, epoch keys or plaintext. Code review
  must reject any endpoint that would accept one.
- Logs: no request bodies, no tokens, no IP addresses by default
  (configurable for abuse handling, off by default, short retention).
- Rate limiting on `intake`, `auth/challenge` and mailbox posts.
- TLS required except on `localhost`; the node can obtain certificates via
  ACME or sit behind a reverse proxy.

## App

- No third-party analytics or crash SDKs that send data off-device by
  default. Crash reports, if any, are opt-in and scrubbed.
- Push notifications are content-free (protocol §14).
- Do not request location "always" permission; "while in use" or manual
  reference points only.
- Calendar access is read-only and used only for local matching.

## Reporting vulnerabilities

Until a dedicated address exists, report privately to the repository owner
rather than opening a public issue.
