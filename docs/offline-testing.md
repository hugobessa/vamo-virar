# Offline and failure scenarios (Phase 8)

`tests/offline` runs the whole stack (domain, crypto, sync and the real
`community-node`) through the situations architecture.md §52 lists. The
node is built with the `test-clock` feature, which adds one test-only
endpoint to move its clock (so days pass in seconds); release builds never
include it. A proxy between the devices and the node can go down, drop
responses after the node processed them, fail at random, or rewrite what
the node returns.

```sh
CARGO_TARGET_DIR=target/test-clock cargo build -p community-node --features test-clock
npm run build && npm test -w @vamo-virar/offline-tests
```

| Scenario | What it shows |
|---|---|
| Member offline 1 / 7 / 30 days | Comes back to exactly the same state as everyone else; queued changes are re-sealed under the new key and sent; a change that no longer makes sense (withdrawing from a finished event) is rejected and reported; after 30 days the log behind the snapshot is compacted and the device restores from the snapshot; finished events have become summaries; the member removed meanwhile learns they were removed |
| Node down | Everyone keeps working (changes visible at once); when the node is back the outcome is deterministic (first acceptance wins a single place; the other person is told the places ran out) |
| Node destroyed | An admin rebuilds it on a new machine at the same address from their phone; nothing is lost; everyone carries on |
| Node tampering with history | The device detects the broken hash chain and keeps nothing from that page; once the node behaves, sync completes |
| Admin offline | Events, volunteering and confirmations continue; join requests wait until an admin returns |
| All admin phones lost | The founder's recovery code, entered on a member's phone, makes them admin; they replace the intake key, remove the lost phone (new epoch key) and the community grows again; the lost phone can read nothing new |
| Random concurrent changes (3 seeds) | Three devices, 30 rounds of random participation and event changes while dropping in and out: all converge; capacity is never exceeded; nobody is confirmed without having said yes |
| Connection that keeps dropping | 25% of requests fail before reaching the node and 25% lose their response after it: nothing lost, nothing applied twice |

## Fixed because of these scenarios

- **Admin recovery deadlock.** Admin power now comes from the control-plane
  admin set alone (protocol §9.2), so the CRK can always restore an admin.
- **Removal notices expired** after 30 days, leaving long-offline removed
  members stuck "waiting for access"; they now persist until read.
- **Half-applied pages.** A page of log entries that fails verification
  part-way is now rolled back entirely.

## Known limits

- A node that tampers with only the **last** entry it serves is noticed
  when the next entry arrives (the chain stops linking), not before; the
  device then refuses to continue until the node is fixed or replaced.
  Comparing chain heads between devices (protocol §13) is future work.
- While every admin is offline nobody can join or be removed. That is by
  design (only admins hold the intake key and can rotate keys).
- Recovery depends on the founder keeping the recovery code safe and off
  the phone. The app shows it once on request with that advice.
