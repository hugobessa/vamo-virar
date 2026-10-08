// Entry point. Polyfills first, then the router.
//
// The noble crypto libraries read randomness from globalThis.crypto. Hermes
// does not provide it, so back it with expo-crypto's native CSPRNG.
import * as ExpoCrypto from "expo-crypto";

const g = globalThis as { crypto?: { getRandomValues?: <T extends ArrayBufferView | null>(a: T) => T } };
if (!g.crypto?.getRandomValues) {
  g.crypto = {
    ...(g.crypto ?? {}),
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array) ExpoCrypto.getRandomValues(array as unknown as Uint8Array);
      return array;
    },
  };
}

import "expo-router/entry";
