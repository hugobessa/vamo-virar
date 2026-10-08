# community-node

The vamo-virar community node: one Rust binary plus one SQLite file. It
sequences each community's encrypted operation log, stores snapshots, and
holds mailboxes for offline members. It never holds a key that can read
community content (see [`docs/protocol.md`](../../docs/protocol.md) §3–§6,
§10–§12, §15 and [`docs/threat-model.md`](../../docs/threat-model.md)).

```sh
cargo run -p community-node -- --listen 127.0.0.1:8787 --data-dir ./data
# or
cargo build -p community-node --release
./target/release/community-node --config apps/node/config.example.toml
```

On start it prints `community-node listening on <addr> node_id=<hex>`.
Logs go to stderr; set `RUST_LOG=info`.

## What it checks

Only what it can verify without keys:

- **access**: every envelope is signed by the current epoch access key (the
  previous one during `epoch_grace_secs` after a rotation);
- **control plane**: genesis signed by the CRK that hashes to the community
  id; `rotate` only by an admin and only to `epoch + 1`; `admin.set` by an
  admin or the CRK;
- **idempotency**: a repeated `op_id` with identical bytes returns its seq;
  different bytes are `op_conflict`;
- **hash chain**: each entry carries the previous entry's hash and the node
  receive time `at`;
- **snapshots**: admin upload only, `head` must be the hash of the entry at
  `seq`, signed with that epoch's access key.

Domain rules (who may invite whom, capacity, …) are checked by devices.

## Authentication

Challenge/response (`POST /v1/auth/challenge`, then `/v1/auth/session`)
with three scopes: `community` (epoch access key, shared by members),
`mailbox` (a member's own key; reads only its own mailbox) and `control`
(admin keys). Tokens are re-checked on every request, so a rotation or
admin change revokes old credentials at once.

## Housekeeping

Every minute: expired mailbox items and auth state are dropped, and the
data-plane log behind a snapshot older than `compaction_grace_secs` is
deleted. Control-plane entries are kept forever; they are what an admin
needs to rebuild the community elsewhere (`POST /v1/communities/restore`).

## Tests

```sh
cargo test -p community-node
```

`tests/api.rs` covers provisioning, sequencing and dedupe, the hash chain,
auth scopes, rotation and the grace window, CRK recovery, mailboxes,
intake/invites/rate limits, snapshots and compaction, and restore on a new
node. `tests/stream.rs` covers WebSocket notifications.
