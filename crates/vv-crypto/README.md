# vv-crypto

Implementação em Rust da suíte VV1, de CBOR determinístico estrito e dos
envelopes de protocolo de que o nó da comunidade precisa: decodificação,
verificação de assinaturas `asig` e de controle, a cadeia de hashes do log e
(para paridade) abertura de operações e de envelopes de chave. Compatível byte a
byte com `packages/crypto`, verificado por `tests/vectors.rs` contra
`tests/vectors/vv1.json`.

```sh
cargo test
```
