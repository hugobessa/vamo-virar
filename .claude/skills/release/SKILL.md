---
name: release
description: Bump an app's version and release it with a tag — the community node, the portal or the mobile app (iOS and Android through EAS). Use when asked to release, ship, publish, bump the version of, or cut a new version of node, portal or mobile.
---

# Releasing an app

Each app has its own version and its own tag. The tag starts
`.github/workflows/release.yml`, which refuses a tag that does not match the
version file, so the version is always bumped (and merged) first.

| App | Tag | Version file | What the tag does |
|---|---|---|---|
| `node` | `node-v0.6.0` | `apps/node/Cargo.toml` (+ `Cargo.lock`) | binaries in a draft GitHub release, `ghcr.io/…/community-node:v0.6.0`, deploy to Railway |
| `portal` | `portal-v0.6.0` | `apps/portal/package.json` (+ `package-lock.json`) | `ghcr.io/…/vamo-virar-portal:v0.6.0`, deploy to Railway |
| `mobile` | `mobile-v1.1.0` | `apps/mobile/app.json` (`expo.version`) | EAS build and submit: iOS to TestFlight, Android to the Play internal track |

`scripts/release-version.mjs` reads and writes these files: `get <app>`,
`next <app> <patch|minor|major>`, `set <app> <version>`, `check-tag <tag>`.
Never edit the version files by hand.

What each app is made of, for finding its changes:

- `node`: `apps/node`, `crates`, `Cargo.toml`, `Cargo.lock`, `deploy`
- `portal`: `apps/portal`
- `mobile`: `apps/mobile`, `packages` (the app bundles them)

## Steps

1. **Which app.** Take it from the request. If it does not say, ask. Several
   apps can be released together: one PR bumps them all, then one tag each.

2. **What changed.** `git fetch origin main --tags`, then find the app's last
   tag: `git tag --list '<app>-v*' --sort=-v:refname | head -1`.
   - No `node-v*`/`portal-v*` tag yet: use the last plain `v*` tag (the node
     and portal used to release together on `v0.5.0` and earlier).
   - No `mobile-v*` tag yet: ask which commit the last store build came
     from (`npx eas-cli@latest build:list --platform all --limit 4` shows
     each build's commit). Don't guess.

   List the changes: `git log --oneline <base>..origin/main -- <app paths>`.
   If there are none, say there is nothing to release and stop.

3. **Pick the level** from what the commits do, reading the diffs where the
   message is not enough:
   - `major`: breaks people already using it. For example, a node that old
     apps or data can no longer talk to, or a mobile release that needs a newer
     node. While the version is `0.x`, a break bumps `minor` instead.
   - `minor`: something new people can use or see.
   - `patch`: only fixes, copy, dependencies or internals.

   If the commits do not make it clear, ask, and show the list you read. A
   pre-release (`1.2.0-rc.1`) is only made when asked: `set` it directly.
   Pre-releases skip Railway and the `latest` image tags.

4. **Bump.** From a branch off `origin/main` named `release/<app>-v<version>`,
   run `node scripts/release-version.mjs next <app> <level>`, then
   `node scripts/release-version.mjs set <app> <that version>`. Run
   `node --test scripts/*.test.mjs` and check `git diff` touches only the
   version files. Commit as `Release <app> v<version>`, push, and open a PR
   whose body lists the commits from step 2 under the new version. Watch it
   until it is merged.

5. **Tag the merge.** After the PR is merged:
   ```
   git fetch origin main --tags
   git checkout --detach origin/main
   node scripts/release-version.mjs check-tag <app>-v<version>
   git tag -a <app>-v<version> -m "<app> v<version>"
   git push origin <app>-v<version>
   ```
   If `check-tag` fails, main does not have the bump; stop and say why.

6. **Follow the release.** Watch the Release workflow run for the tag and
   report how it ended, with links: the draft GitHub release for the node,
   the images, the Railway deploy, or for mobile the EAS build and submission
   pages and their build numbers. Publishing the draft GitHub release, App
   Store review and the Play production rollout stay manual. Say so.

## When the release fails

- **Mobile build fails on credentials.** Examples: a provisioning profile
  missing a capability, or an expired certificate. These need the owner's Apple
  or Google login. Report the error from the EAS build page and what to change.
  Then re-run the failed workflow job; don't move the tag.
- **Tag points at the wrong commit.** Ask before deleting a pushed tag. Prefer
  a new patch release over rewriting one.
