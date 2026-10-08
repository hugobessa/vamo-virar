# @vamo-virar/domain

The community state machine: `state = fold(reduce, genesis, log)`
([`docs/protocol.md`](../../docs/protocol.md) §8, §9, §12).

Pure TypeScript with no networking, storage or crypto. It takes log entries
that the crypto layer (Phase 2) has already decrypted and verified, and
returns the next state plus an outcome (`applied`, `rejected(reason)`,
`opaque`, `duplicate`).

```ts
import { fold, applyInPlace, createSnapshot, restoreSnapshot } from "@vamo-virar/domain";

const { state, outcomes } = fold(entries);         // full replay from genesis
const snap = createSnapshot(state);                 // durable state at state.clock.seq
const restored = restoreSnapshot(snap);             // …later, on another device
for (const e of tail) applyInPlace(restored, e);    // same state as a full replay
```

Guarantees, enforced by the property tests in `test/properties.test.ts`:

- deterministic: same log ⇒ same state, on every device;
- snapshot + tail ⇒ same state as the full log, at any cut point;
- rejected ops and duplicate `op_id`s change nothing but bookkeeping;
- nobody is confirmed for an event without their own `accept` or `volunteer`;
- a new confirmation never exceeds capacity;
- removed members hold no open place in a scheduled event.

Not yet: deterministic CBOR (state hashes use canonical JSON until the
protocol package exists), crypto verification, the pending-op overlay used
by sync (Phase 4).

```sh
npm test            # from the repo root
npm run typecheck
```
