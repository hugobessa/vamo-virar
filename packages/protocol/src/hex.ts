import { encodeUtf8 } from "./utf8.js";

const HEX = "0123456789abcdef";

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const byte of b) s += HEX[byte >> 4]! + HEX[byte & 15]!;
  return s;
}

/** Strict lowercase hex → bytes. Throws on odd length or invalid characters. */
export function fromHex(s: string): Uint8Array {
  if (s.length % 2 !== 0 || !/^[0-9a-f]*$/.test(s)) throw new Error("invalid hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error("u32 out of range");
  return new Uint8Array([n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

export function utf8(s: string): Uint8Array {
  return encodeUtf8(s);
}
