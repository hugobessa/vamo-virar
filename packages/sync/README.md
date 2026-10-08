# @vamo-virar/sync

The client side of the protocol: everything a device does to take part in a
community. It ties together `@vamo-virar/domain` (state), `@vamo-virar/crypto`
(envelopes) and a community node over HTTP + WebSocket. It uses only `fetch`
and `WebSocket`, so the same code runs in React Native and Node.

```ts
import { NodeClient, Replica, parseInvite } from "@vamo-virar/sync";

// Founder
const ana = await Replica.found(new NodeClient(url, { provisioningToken }), { name: "Coletivo", displayName: "Ana" });
const link = await ana.createInvite({ maxUses: 1 });

// Applicant
const bia = await Replica.join(new NodeClient(url), parseInvite(link), { displayName: "Bia" });

// Admin
for (const req of await ana.joinRequests()) await ana.approve(req);

// Everyone
await bia.sync();                         // mailbox → push → pull
bia.submit("participation.volunteer", { event_id });   // shows in bia.view at once
const stop = await bia.watch();           // sync when the node announces changes
const bytes = bia.save();                 // persist; Replica.load(client, bytes) later
```

`Replica` handles: per-community keys, the verified log tail, the outbox
(re-sealed under the newest epoch on each send, idempotent by `op_id`),
optimistic `view` vs `canonical` state, key envelopes and other sealed mail,
bootstrapping from a snapshot (and again after a `410 Gone`), waiting for a
missing epoch key instead of folding opaque entries, and admin flows:
join requests, approve/reject, remove member (with rotation, removal
notice, and a new intake key if an admin leaves), make admin, snapshots,
invites, intake mode, and rebuilding the community on another node
(`restoreTo`, then `moveTo` on other devices).

## Tests

`test/integration.test.ts` runs against the real `community-node` binary
(`cargo build -p community-node`, or set `VV_NODE_BIN`); without it those
tests are skipped locally and required in CI. Scenarios: founding and
joining (open and invite-only), rejection, 700-op catch-up with
pagination, removal and rotation with an offline member, an outbox waiting
for a delayed key, a lost response retried without duplication,
persistence, live notifications, compaction with snapshot bootstrap for
both lagging and new members, and moving a community to a new node.
