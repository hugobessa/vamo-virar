# Managed hosting

Phase 10 (architecture.md §41, §52). A managed host runs **the same
`community-node` binary** that a community can run on a Raspberry Pi. There
is no separate managed build, no vendor SDK, and no protocol feature that
only a managed host has. What managed hosting adds is operational:

- **tenants**: customers who provision communities with their own token,
  each with optional limits;
- **an operator API** on a separate, private listener: usage, suspension,
  deletion, export and Prometheus metrics;
- **moving a community in or out**: an admin moves it between any two
  nodes from the app, and every member follows on their own.

The rule this design keeps: **the provider is replaceable**. A community
can always leave, even when suspended or over quota, and a node never holds
a community's data hostage.

## Provider independence

The node protocol does not depend on AWS, GCP, Azure, Cloudflare, Supabase
or Firebase. `scripts/check-vendor-independence.mjs` enforces this in CI
(job `vendor-independence`): no cloud-vendor SDK may appear in `Cargo.lock`
or `package-lock.json`, and no vendor host or SDK may be referenced in the
node, the protocol packages or `deploy/`. Any machine that runs a Linux
binary or a container works; storage is one SQLite file on a local disk.

The mobile app's optional calendar adapters call Google and Microsoft
calendar APIs on the person's behalf, on the device. That is a calendar
integration chosen by the person, not part of the node protocol.

## Running a node for many communities

One node process holds any number of communities in one database; there is
nothing per-community to start or stop. A typical managed setup:

```toml
# /etc/community-node/config.toml
listen = "127.0.0.1:8787"            # behind Caddy/nginx with TLS
data_dir = "/var/lib/community-node"
trust_forwarded_for = true

# The operator API: never on a public interface.
operator_listen = "127.0.0.1:9787"
# operator_token comes from VV_OPERATOR_TOKEN (at least 16 characters).

# Your own provisioning token, for communities you host without a plan
# (and for restores you do on someone's behalf). Optional.
# provisioning_token = "..."

[[tenants]]
name = "coletivo-recife"
token_sha256 = "9f2c…"               # from `community-node tenant-token`
max_communities = 3
max_log_bytes = 268435456             # 256 MiB of log per community

[[tenants]]
name = "free-tier"
token_sha256 = "41ab…"
max_communities = 1
max_log_bytes = 16777216
```

`community-node tenant-token` prints a new random token for the customer
and the `token_sha256` line for the config. The config file holds only the
hash. A tenant uses their token as the "setup code" when creating a
community in the app (or when moving one in).

Scale by running more nodes, each with its own disk, and giving each
tenant (or community) the address of the node that hosts it. Nodes do not
talk to each other; a community lives on exactly one node at a time, and
moving it is the protocol operation below.

### Limits

| Limit | Applies to | When reached |
|---|---|---|
| `max_communities` | create and restore with that tenant's token | `507 quota_exceeded`; the app shows the error |
| `max_log_bytes` | each community the tenant provisioned | ops are refused one by one with `quota_exceeded`; they **stay in the members' outboxes** and the app says the community ran out of space |

Log size counts stored log entries. An admin's snapshot lets the node
compact the log behind it (after `compaction_grace_secs`), which frees
quota; snapshot uploads are accepted while over quota for that reason.
Mailboxes are bounded separately (`max_mailbox_items`, TTLs) and do not
count. `migrate` is always accepted, so a community over quota can leave.

## The operator API

Served only when `operator_listen` is set, on that address only, with
`Authorization: Bearer <operator_token>`. JSON, except export (CBOR).

| Method & path | What it does |
|---|---|
| `GET /operator/v1/communities` | Every community: id, tenant, created_at, head_seq, epoch, log/snapshot/mailbox bytes and counts, waiting join requests, suspended, moved_to, intake mode |
| `GET /operator/v1/tenants` | Per tenant: communities, log bytes, and the configured limits |
| `POST /operator/v1/communities/{id}/suspend` | Writes are refused with `403 suspended`; reads, export and `migrate` keep working |
| `POST /operator/v1/communities/{id}/resume` | Undoes a suspension |
| `GET /operator/v1/communities/{id}/export` | The community's restore payload (`application/cbor`), e.g. to hand it back when closing an account |
| `DELETE /operator/v1/communities/{id}?confirm={id}` | Deletes every row of the community and ends its sessions. Irreversible |
| `GET /operator/v1/metrics` | Prometheus text format |

```sh
export T=$VV_OPERATOR_TOKEN
curl -s -H "Authorization: Bearer $T" http://127.0.0.1:9787/operator/v1/communities | jq
curl -s -H "Authorization: Bearer $T" -X POST http://127.0.0.1:9787/operator/v1/communities/$ID/suspend
```

Metrics are aggregated **per tenant, never per community**
(`vv_communities`, `vv_communities_suspended`, `vv_communities_moved`,
`vv_log_bytes`, `vv_snapshot_bytes`, `vv_mailbox_items`,
`vv_mailbox_bytes`, `vv_intake_items` with a `tenant` label, plus
`vv_sessions` and `vv_schema_version`), so shipping them to a monitoring
service does not publish a list of communities.

What the operator API can see is exactly what the database already holds
(threat-model.md, adversary A1): opaque ids, sizes, counts, times and
admins' public keys. It has no endpoint that reveals or changes content,
members, roles or keys. Suspension and deletion are the only levers, and
neither can make a community stay: export works while suspended, and the
admins' phones can rebuild the community anywhere even after a deletion.

## Moving a community in or out (protocol.md §11.3)

From the app: **Me → Move to another server**, enter the new server's
address and, if it asks for one, its setup code (the node's provisioning
token or a tenant token). Under the hood, `Replica.migrateTo`:

1. checks the target answers `/.well-known/vamo-virar`;
2. submits a `migrate` control op, signed by the admin, naming the new
   node. The old node accepts it and from then on **refuses every write**
   with `409 moved` and the new address, so nothing can land there that the
   new node would not have. Reads keep working;
3. restores the community on the target from the log this device has
   verified (`POST /v1/communities/restore`), carrying over the intake mode
   and outstanding invite links from the old node's export;
4. re-delivers the current key to every member's mailbox on the new node
   (mailboxes are not moved) and switches to it.

If the restore fails (no setup code, quota, a typo), the app signs a second
`migrate` with an empty list, which cancels the move on the old node.

Members' phones follow on their next sync:

- a phone that tries to write gets `409 moved` and keeps the change in its
  outbox;
- it pulls the log from the old node, finds the `migrate` entry, **checks
  the admin's signature itself**, and switches to the first listed node
  that already hosts the community;
- it then sends what was waiting. Nothing is lost or duplicated (op ids are
  kept).

A phone never follows a bare `409 moved` from a node: only a signed
`migrate` in the log moves it. A dishonest node or network can at most stop
a phone from writing, which it could do anyway.

Invite links shared before the move keep working: a join request sent to
the old node is answered with the new address and re-sent there (it is
sealed to the community's intake key, so following the hint can at worst
lose it, never expose it).

### Keep moved communities readable for a while

Members who are offline during the move learn the new address from the old
node's log. Keep a moved community on the old node, read-only, for at least
`compaction_grace_secs` (30 days by default); the operator listing shows
`moved_to`. After that, delete it with the operator API. A member who
missed that window can still be pointed at the new node by hand
(`Replica.moveTo`; in the app, by re-joining with a new link from the new
node).

### When the old node is gone

`migrate` needs the old node. If it disappeared, an admin rebuilds the
community from their phone with `Replica.restoreTo` (§11.3, §11.4), and
members are pointed at the new address out of band (a new link). This was
already possible before managed hosting and still is.

## Checklist for a hosting provider

- Run the release binary or image unchanged; do not patch the node.
- `operator_listen` on loopback or a private network only; a long random
  `VV_OPERATOR_TOKEN`; TLS in front of `listen` (the bundled Caddy setup).
- Back up `node.sqlite` with `community-node backup` (deploy.md).
- Never suspend without notice, and never delete a community that has not
  been offered its export or had time to move.
- Upgrade by replacing the binary: schema changes are applied on start
  (deploy.md, "Upgrades").
