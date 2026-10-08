import { decodeUtf8, encodeUtf8 } from "./utf8.js";

// Deterministic CBOR (RFC 8949 §4.2.1, "Core Deterministic Encoding"),
// restricted to the subset the protocol uses (protocol.md §1.1):
//
//   unsigned/negative integers (JS safe integers), byte strings, text
//   strings, arrays, maps with text keys, false, true, null.
//
// No floats, tags, undefined, or indefinite lengths. The decoder is strict:
// it rejects anything the encoder would not have produced, so every value
// has exactly one valid encoding and signatures over encodings are
// unambiguous. crates/vv-crypto/src/cbor.rs implements the same rules.

export type CborValue =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | { [key: string]: CborValue | undefined };

export class CborError extends Error {}


const MAX_DEPTH = 32;

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

class Writer {
  private buf = new Uint8Array(256);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(b: number): void {
    this.ensure(1);
    this.buf[this.len++] = b;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  /** Major type + argument, in the shortest form. */
  head(major: number, arg: number): void {
    const m = major << 5;
    if (arg < 24) {
      this.byte(m | arg);
    } else if (arg < 0x100) {
      this.byte(m | 24);
      this.byte(arg);
    } else if (arg < 0x10000) {
      this.byte(m | 25);
      this.byte(arg >>> 8);
      this.byte(arg & 0xff);
    } else if (arg < 0x100000000) {
      this.byte(m | 26);
      for (let s = 24; s >= 0; s -= 8) this.byte((arg >>> s) & 0xff);
    } else {
      this.byte(m | 27);
      const hi = Math.floor(arg / 0x100000000);
      const lo = arg >>> 0;
      for (let s = 24; s >= 0; s -= 8) this.byte((hi >>> s) & 0xff);
      for (let s = 24; s >= 0; s -= 8) this.byte((lo >>> s) & 0xff);
    }
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

export function encode(value: CborValue): Uint8Array {
  const w = new Writer();
  write(w, value, 0);
  return w.result();
}

function write(w: Writer, v: CborValue | undefined, depth: number): void {
  if (depth > MAX_DEPTH) throw new CborError("nesting too deep");
  if (v === undefined) throw new CborError("undefined is not encodable");
  if (v === null) return w.byte(0xf6);
  if (v === false) return w.byte(0xf4);
  if (v === true) return w.byte(0xf5);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new CborError(`not a safe integer: ${v}`);
    return v >= 0 ? w.head(0, v) : w.head(1, -1 - v);
  }
  if (typeof v === "string") {
    let b: Uint8Array;
    try {
      b = encodeUtf8(v);
    } catch {
      throw new CborError("text is not valid Unicode");
    }
    w.head(3, b.length);
    return w.bytes(b);
  }
  if (v instanceof Uint8Array) {
    w.head(2, v.length);
    return w.bytes(v);
  }
  if (Array.isArray(v)) {
    w.head(4, v.length);
    for (const item of v) write(w, item, depth + 1);
    return;
  }
  if (typeof v === "object") {
    // Absent optional fields are `undefined`; they are omitted, never encoded.
    const entries: [Uint8Array, CborValue][] = [];
    for (const k of Object.keys(v)) {
      const val = v[k];
      if (val === undefined) continue;
      entries.push([encode(k), val]);
    }
    entries.sort((a, b) => compareBytes(a[0], b[0]));
    w.head(5, entries.length);
    for (const [k, val] of entries) {
      w.bytes(k);
      write(w, val, depth + 1);
    }
    return;
  }
  throw new CborError(`unsupported type: ${typeof v}`);
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Decoding (strict)
// ---------------------------------------------------------------------------

export function decode(bytes: Uint8Array): CborValue {
  const r = { b: bytes, i: 0 };
  const v = read(r, 0);
  if (r.i !== bytes.length) throw new CborError("trailing bytes");
  return v;
}

interface Reader {
  b: Uint8Array;
  i: number;
}

function take(r: Reader, n: number): Uint8Array {
  if (n > r.b.length - r.i) throw new CborError("unexpected end of input");
  const out = r.b.subarray(r.i, r.i + n);
  r.i += n;
  return out;
}

function readArg(r: Reader, info: number): number {
  if (info < 24) return info;
  let n: number;
  let min: number;
  switch (info) {
    case 24:
      n = 1;
      min = 24;
      break;
    case 25:
      n = 2;
      min = 0x100;
      break;
    case 26:
      n = 4;
      min = 0x10000;
      break;
    case 27:
      n = 8;
      min = 0x100000000;
      break;
    default:
      // 28–30 reserved, 31 indefinite length: never valid here.
      throw new CborError(`unsupported additional info ${info}`);
  }
  const b = take(r, n);
  let v = 0;
  for (const byte of b) {
    v = v * 256 + byte;
    if (v > Number.MAX_SAFE_INTEGER) throw new CborError("integer exceeds safe range");
  }
  if (v < min) throw new CborError("non-shortest integer encoding");
  return v;
}

function read(r: Reader, depth: number): CborValue {
  if (depth > MAX_DEPTH) throw new CborError("nesting too deep");
  const [first] = take(r, 1);
  const major = first! >> 5;
  const info = first! & 0x1f;

  switch (major) {
    case 0:
      return readArg(r, info);
    case 1: {
      const n = readArg(r, info);
      if (n >= Number.MAX_SAFE_INTEGER) throw new CborError("integer exceeds safe range");
      return -1 - n;
    }
    case 2:
      return take(r, readArg(r, info)).slice();
    case 3: {
      const raw = take(r, readArg(r, info));
      try {
        return decodeUtf8(raw);
      } catch {
        throw new CborError("invalid UTF-8");
      }
    }
    case 4: {
      const n = readArg(r, info);
      if (n > r.b.length - r.i) throw new CborError("array length exceeds input");
      const out: CborValue[] = [];
      for (let k = 0; k < n; k++) out.push(read(r, depth + 1));
      return out;
    }
    case 5: {
      const n = readArg(r, info);
      if (n > r.b.length - r.i) throw new CborError("map length exceeds input");
      const out: Record<string, CborValue> = Object.create(null);
      let prevKey: Uint8Array | null = null;
      for (let k = 0; k < n; k++) {
        const keyStart = r.i;
        if (((r.b[r.i] ?? 0) >> 5) !== 3) throw new CborError("map keys must be text");
        const key = read(r, depth + 1) as string;
        const keyBytes = r.b.subarray(keyStart, r.i);
        if (prevKey && compareBytes(prevKey, keyBytes) >= 0) {
          throw new CborError("map keys not in canonical order or duplicated");
        }
        prevKey = keyBytes;
        out[key] = read(r, depth + 1);
      }
      // Return an ordinary object so callers can use normal property access.
      return { ...out };
    }
    case 6:
      throw new CborError("tags are not allowed");
    case 7:
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      throw new CborError(`simple value / float ${info} not allowed`);
  }
  throw new CborError("unreachable");
}
