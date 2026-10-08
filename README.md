# vamo-virar

A privacy-preserving, local-first platform for organizing community events
and coordinating the people who attend them.

- Your phone keeps your calendar, location and availability. Nothing about
  them leaves the device; it only answers "can I make it?".
- A community's shared state is end-to-end encrypted and synced through a
  small, replaceable **community node**: one Rust binary plus SQLite that runs
  on a VPS, a Raspberry Pi or a spare computer.
- Communities and members are identified by keys, not servers, so a node can
  be replaced without losing the community.

## Status

Phase 0: protocol specification. No code yet.

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Goals, principles and the overall design |
| [`docs/protocol.md`](docs/protocol.md) | Normative wire protocol, operations, sync, keys (draft v0) |
| [`docs/threat-model.md`](docs/threat-model.md) | Adversaries and what the design does and doesn't protect against |
| [`docs/security.md`](docs/security.md) | Implementation rules for crypto, keys, node and app |

## Planned layout

```
apps/mobile      React Native app (iOS, Android)
apps/node        Rust community node
packages/*       TypeScript domain, protocol, crypto, sync
crates/*         Rust crypto, protocol, storage
tests/           Shared protocol/crypto test vectors, integration tests
```

See the implementation plan in `docs/architecture.md` §52.

## License

[MIT](LICENSE).
