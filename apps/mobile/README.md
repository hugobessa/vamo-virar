# Vamo Virar — mobile app

Expo (SDK 57) + React Native app built on `@vamo-virar/sync`,
`@vamo-virar/crypto` and `@vamo-virar/domain`. Portuguese first, English
fallback, no protocol jargon in the UI.

## Run

```sh
npm install && npm run build          # from the repo root: builds the shared packages
cargo run -p community-node -- --data-dir ./data   # a node to talk to (set VV_PROVISIONING_TOKEN)
cd apps/mobile && npx expo start       # then open in Expo Go or a development build
```

All native modules used (`expo-secure-store`, `expo-file-system`,
`expo-crypto`, `expo-localization`) are included in Expo Go. Phone and node
must reach each other: use the computer's LAN address as the server address.

## Structure

```
index.ts           polyfills (crypto.getRandomValues via expo-crypto), then expo-router
src/app/           screens (expo-router): home, create, join (also the vamovirar://join deep link),
                   community (events / people / me), event detail, new event
src/model/         platform-independent logic, unit-tested: which actions to offer,
                   lists, date entry, places, sync status, strings (pt/en)
src/lib/           AppStore (replicas, background sync, live updates), SealedStore
                   (encrypted persistence), React context
src/ui/            UI kit (48 pt touch targets, light/dark), tab components
```

## Storage

Each community's replica is sealed with XChaCha20-Poly1305 under a device
key held in the iOS Keychain / Android Keystore (`expo-secure-store`,
after-first-unlock, this device only) and written to the app's document
directory. The web build exists only for development and automated UI
tests; it stores data unencrypted and says so on screen.

## Tests

```sh
npm test -w @vamo-virar/mobile        # model unit tests, incl. "the UI offers exactly what the reducer accepts"
npm run typecheck -w @vamo-virar/mobile
# End to end in headless Chromium against a real node (web build):
cargo build -p community-node
(cd apps/mobile && npx expo export --platform web --output-dir dist-web)
npm run e2e:web -w @vamo-virar/mobile  # CHROME_PATH=/path/to/chrome if not at /opt/pw-browsers/chromium
```

The end-to-end script plays two people in separate browser profiles: create
community → invite link → join request → accept → new event → volunteer →
confirm, saving a screenshot of each step.
