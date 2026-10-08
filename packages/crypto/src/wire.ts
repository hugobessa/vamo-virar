// Strict shape validation for decoded CBOR. Every decoder in this package
// goes through these helpers so malformed input fails closed.

import type { CborValue } from "@vamo-virar/protocol";

export class WireError extends Error {}

export type CborMap = { [key: string]: CborValue | undefined };

export function asMap(v: CborValue | undefined, allowed: readonly string[]): CborMap {
  if (typeof v !== "object" || v === null || Array.isArray(v) || v instanceof Uint8Array) {
    throw new WireError("expected map");
  }
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new WireError(`unexpected field ${k}`);
  return v;
}

export function asBytes(v: CborValue | undefined, len?: number): Uint8Array {
  if (!(v instanceof Uint8Array)) throw new WireError("expected bytes");
  if (len !== undefined && v.length !== len) throw new WireError(`expected ${len} bytes`);
  return v;
}

export function asUint(v: CborValue | undefined, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max) throw new WireError("expected uint");
  return v;
}

export function asText(v: CborValue | undefined, maxLen = 256): string {
  if (typeof v !== "string" || v.length > maxLen) throw new WireError("expected text");
  return v;
}

export function asArray(v: CborValue | undefined, maxLen = 1024): CborValue[] {
  if (!Array.isArray(v) || v.length > maxLen) throw new WireError("expected array");
  return v;
}

export function optional<T>(v: CborValue | undefined, f: (v: CborValue) => T): T | undefined {
  return v === undefined ? undefined : f(v);
}

export const U32_MAX = 0xffffffff;
