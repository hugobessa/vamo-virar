# Threat Model — v0 (draft)

Scope: the protocol in [`protocol.md`](protocol.md), one community node per
community, iOS/Android clients. Section numbers (§) refer to `protocol.md`.

## Assets

| Asset | Where it lives | Sensitivity |
|---|---|---|
| Personal calendar | device only | high |
| Location (GPS, reference points) | device only | high |
| Who is a member of which community | encrypted in log (data plane) | **high** (political organizing) |
| Who attends which event | encrypted in log | high |
| Event details (time, place) | encrypted in log | medium–high |
| Admin set (per-community public keys) | node, cleartext | low–medium |
| Community name/description in directory | public by choice | low |
| Private keys | device secure storage | critical |

## Adversaries

| # | Adversary | Capabilities assumed |
|---|---|---|
| A1 | Curious/compromised node operator | Full read/write of node DB and process; sees all traffic metadata |
| A2 | Database thief | One-time copy of `community.sqlite` |
| A3 | Network attacker | Passive and active on the path; cannot break TLS without a CA compromise |
| A4 | Removed member | Holds every key up to their removal epoch; knows the protocol |
| A5 | Malicious member | Current member, valid keys |
| A6 | Malicious admin | Current admin |
| A7 | Device thief | Physical access to a phone, possibly unlocked |
| A8 | Push provider (Apple/Google), push gateway | Sees push tokens and timing |
| A9 | Outsider spammer/harasser | Knows community ID and node URL |

## The 12 scenarios from the architecture

| # | Scenario | Outcome in v0 | Mechanism |
|---|---|---|---|
| 1 | Compromised node (A1) | Cannot read content, forge ops, or learn roster/roles beyond admins. **Can** withhold/delay ops, fork the log per device, observe timing, IPs, sizes, mailbox activity. | §3, §4, §13 |
| 2 | Malicious admin (A6) | Can add/remove members, read everything, write false snapshots, rotate keys to exclude others. **Cannot** forge other members' ops (e.g. fake an acceptance). CRK holder can remove them via `admin.set`. | §5, §9.2, §11.4 |
| 3 | Stolen node DB (A2) | Ciphertexts, public keys, signatures, `op_id` index, metadata. No keys. | §2, §29 arch |
| 4 | Network interception (A3) | TLS; even with TLS broken, payloads are E2E encrypted and auth tokens are scope- and node-bound. | §3.1, §4 |
| 5 | Compromised user device/account (A5 via malware) | Attacker acts as that member until removed. Their reach is that member's role. Mitigated by removal + rotation. | §7.2 |
| 6 | Stolen phone (A7) | Locked phone: keys protected by keystore. Unlocked phone: attacker has that membership. App SHOULD support an app PIN/biometric gate and remote "I lost my phone" via another member contacting an admin. | §2.4 |
| 7 | Removed member (A4) | Reads history up to removal (unavoidable). Cannot read anything after the `rotate`. Late ops in grace window rejected by reducer. | §7.3–7.4 |
| 8 | Destroyed node | Rebuild from admin device. | §11.3 |
| 9 | Replaced / impostor node | Devices pin `node_id` per community; new node URL must come from a signed `DirectoryEntry` or in-band signed op. Impostor cannot produce entries that chain from the device's head. | §11, §13 |
| 10 | Replayed operation | Inner signature binds `op_id`, `cid`, `epoch`; node and reducer dedupe by `op_id`. | §4.3, §6.3 |
| 11 | Duplicated operation | Idempotent submission; reducer ignores duplicate `op_id`. | §6.3 |
| 12 | Long-offline device | Log replay ≤ 30 d, else snapshot. Key envelopes for the current epoch never expire. | §7.3, §12.4 |

## Additional threats

| Threat | Status |
|---|---|
| Spam / harassment via intake (A9) | Rate limits; invite-only policy; open question §17.7. |
| Traffic analysis linking a person across communities | Mitigated by per-community keys. Not mitigated: same IP / same push token across communities (A1 + A8). |
| Push notification content leak | Content-free pushes only; tokens sealed to gateway. §14 |
| "Who could come?" probes revealing schedules | Replies carry one of three verdicts, sealed to the asking organizer and signed by the member; no times, places or distances. The node sees that N items were posted and roughly when replies came back (metadata). Auto-answer is off by default. protocol §10.4 |
| Location history | Never collected. Places are chosen by the person; "where I am now" is one coarse reading (≈ 1 km) kept for a day, on the device only. iOS/Android background location is disabled in the build. |
| Coercion (someone forces a member to unlock their phone) | Out of scope for v0. Candidate **[LATER]**: per-community "hide this community" with separate PIN. |
| Fork attack by node (A1) | Detected only on cross-device comparison; full detection is **[LATER]**. §13 |
| Malicious snapshot by admin | Detected by members holding the log; not by new members. §17.5 |
| Supply chain (malicious app update) | Out of protocol scope. Reproducible builds and F-Droid distribution are desirable. |

## Explicit non-goals for v0

- Hiding *that* a device talks to a given node (IP-level metadata).
- Hiding message sizes and timing.
- Protecting a member against their own unlocked, compromised device.
- Forward secrecy within an epoch (a device compromise exposes the whole
  current epoch). Shorter epochs via scheduled rotation reduce this.
