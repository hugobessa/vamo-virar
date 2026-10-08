import { sha256 } from "@noble/hashes/sha2";
import { concatBytes, utf8 } from "@vamo-virar/protocol";
import type { Rng } from "../src/primitives.js";

/** Deterministic RNG for tests and vectors: SHA-256(seed || counter) blocks. */
export function seededRng(seed: string): Rng {
  let counter = 0;
  const s = utf8(seed);
  return (n) => {
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const c = new Uint8Array(4);
      new DataView(c.buffer).setUint32(0, counter++);
      const block = sha256(concatBytes(s, c));
      const take = Math.min(block.length, n - o);
      out.set(block.subarray(0, take), o);
      o += take;
    }
    return out;
  };
}

export function flipBit(b: Uint8Array, index = 0): Uint8Array {
  const out = b.slice();
  out[index % out.length]! ^= 1;
  return out;
}

export function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
