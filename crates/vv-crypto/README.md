# vv-crypto

Rust implementation of the VV1 suite, strict deterministic CBOR and the
protocol envelopes the community node needs: decoding, `asig` and control
signature checks, the log hash chain, and (for parity) opening ops and key
envelopes. Byte-compatible with `packages/crypto`, checked by
`tests/vectors.rs` against `tests/vectors/vv1.json`.

```sh
cargo test
```
