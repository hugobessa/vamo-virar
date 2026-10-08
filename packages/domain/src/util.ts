import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { Hex, MemberId } from "./types.js";

const MEMBER_ID_CTX = utf8ToBytes("vv/member-id/v1");

/** member_id = SHA-256("vv/member-id/v1" || MSK.public), protocol.md §2.2. */
export function memberIdOf(msk: Hex): MemberId {
  const key = hexToBytes(msk);
  const buf = new Uint8Array(MEMBER_ID_CTX.length + key.length);
  buf.set(MEMBER_ID_CTX, 0);
  buf.set(key, MEMBER_ID_CTX.length);
  return bytesToHex(sha256(buf));
}

const HEX_RE = /^(?:[0-9a-f]{2})+$/;

export function isHex(v: unknown, bytes?: number): v is Hex {
  return (
    typeof v === "string" &&
    HEX_RE.test(v) &&
    (bytes === undefined || v.length === bytes * 2)
  );
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isInt(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}

export function isText(v: unknown, maxLen: number, minLen = 0): v is string {
  return typeof v === "string" && v.length >= minLen && v.length <= maxLen;
}

/** Deep copy of plain JSON-like data. Avoids structuredClone, which Hermes lacks. */
export function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (isObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = clone(v[k]);
    return out as T;
  }
  return v;
}

/**
 * Canonical JSON: sorted object keys, no whitespace, `undefined` fields
 * dropped. Used to compare states for equality in tests and to fingerprint
 * state until the protocol package provides deterministic CBOR (§1.1).
 */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isObject(v)) {
    const parts: string[] = [];
    for (const k of Object.keys(v).sort()) {
      if (v[k] === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicalJson(v[k])}`);
    }
    return `{${parts.join(",")}}`;
  }
  if (typeof v === "number" && !Number.isSafeInteger(v)) {
    throw new Error(`non-integer number in canonical data: ${v}`);
  }
  return JSON.stringify(v);
}

export function sortedKeys<T>(rec: Record<string, T>): string[] {
  return Object.keys(rec).sort();
}
