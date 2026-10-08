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

- Phase 0 — protocol specification: draft v0 in `docs/`.
- Phase 1 — local domain engine: [`packages/domain`](packages/domain) (state
  machine, snapshots, retention; unit and property tests).
- Phase 2 — cryptographic layer: [`packages/protocol`](packages/protocol)
  (strict CBOR), [`packages/crypto`](packages/crypto) (VV1 suite, envelopes,
  rotation, snapshots, intake) and [`crates/vv-crypto`](crates/vv-crypto)
  (Rust, same test vectors).
- Phase 3 — community node: [`apps/node`](apps/node) (Rust + SQLite,
  HTTP + WebSocket; sequencing, auth scopes, mailboxes, intake, snapshots,
  compaction, restore).
- Phase 4 — sync engine: [`packages/sync`](packages/sync) (node client,
  replica with outbox and optimistic view, mailbox, snapshot bootstrap,
  admin flows, node migration; integration tests against the real node).
- Phase 5 — mobile app: [`apps/mobile`](apps/mobile) (Expo SDK 57; create,
  join, invite, approve, events, volunteer/invite/confirm, people, encrypted
  storage; model unit tests and a web end-to-end run against a real node).
- Phase 6 — calendar integrations: [`packages/matching`](packages/matching)
  and the app's calendar settings (phone calendars, Google free/busy,
  Outlook; availability computed on the phone; see
  [`docs/calendars.md`](docs/calendars.md)).
- Phase 7 — location matching and "who could come?": places with radius and
  dates, one-off coarse current location, travel time, and signed,
  verdict-only probe answers (protocol §10.4).
- Phase 8 — offline and failure scenarios: [`tests/offline`](tests/offline)
  against the real node with a moving clock and a fault-injecting proxy
  (see [`docs/offline-testing.md`](docs/offline-testing.md)); admin
  recovery with the founder's recovery code.
- Phase 9 — node deployment: Docker image (distroless, non-root, health
  check), Compose + Caddy with automatic TLS, hardened systemd unit,
  `health`/`backup` subcommands, and a tag-triggered release of binaries
  (Linux x86-64/ARM64, macOS, Windows) and multi-arch images. See
  [`docs/deploy.md`](docs/deploy.md).
- Phase 10 — managed hosting: the same binary with tenants and quotas, a
  private operator API (usage, suspension, export, metrics), schema
  upgrades on start, and moving a community between any two nodes with a
  signed `migrate` that members follow on their own. CI checks the node
  protocol stays free of cloud-vendor dependencies. See
  [`docs/managed-hosting.md`](docs/managed-hosting.md).

```sh
npm install && npm test     # TypeScript packages
cargo test                  # Rust crates
```

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Goals, principles and the overall design |
| [`docs/protocol.md`](docs/protocol.md) | Normative wire protocol, operations, sync, keys (draft v0) |
| [`docs/threat-model.md`](docs/threat-model.md) | Adversaries and what the design does and doesn't protect against |
| [`docs/security.md`](docs/security.md) | Implementation rules for crypto, keys, node and app |
| [`docs/deploy.md`](docs/deploy.md) | Running a community node |
| [`docs/managed-hosting.md`](docs/managed-hosting.md) | Hosting many communities; moving a community between nodes |

## Planned layout

```
apps/mobile      React Native app (iOS, Android)
apps/node        Rust community node
packages/*       TypeScript domain, protocol, crypto, sync
crates/*         Rust crypto, protocol, storage
tests/           Shared protocol/crypto test vectors, integration tests
```

See the implementation plan in `docs/architecture.md` §52.
