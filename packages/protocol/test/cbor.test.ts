import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CborError, decode, encode, type CborValue } from "../src/cbor.js";
import { fromHex, toHex } from "../src/hex.js";

// RFC 8949 Appendix A (the subset we support).
const RFC_VECTORS: [CborValue, string][] = [
  [0, "00"],
  [1, "01"],
  [10, "0a"],
  [23, "17"],
  [24, "1818"],
  [25, "1819"],
  [100, "1864"],
  [1000, "1903e8"],
  [1000000, "1a000f4240"],
  [1000000000000, "1b000000e8d4a51000"],
  [-1, "20"],
  [-10, "29"],
  [-100, "3863"],
  [-1000, "3903e7"],
  [false, "f4"],
  [true, "f5"],
  [null, "f6"],
  [new Uint8Array(), "40"],
  [fromHex("01020304"), "4401020304"],
  ["", "60"],
  ["a", "6161"],
  ["IETF", "6449455446"],
  ["ü", "62c3bc"],
  ["水", "63e6b0b4"],
  [[], "80"],
  [[1, 2, 3], "83010203"],
  [[1, [2, 3], [4, 5]], "8301820203820405"],
  [{}, "a0"],
  [{ a: 1, b: [2, 3] }, "a26161016162820203"],
  [["a", { b: "c" }], "826161a161626163"],
];

describe("encode", () => {
  for (const [value, hex] of RFC_VECTORS) {
    it(`${JSON.stringify(value, (_k, v) => (v instanceof Uint8Array ? toHex(v) : v))} → ${hex}`, () => {
      expect(toHex(encode(value))).toBe(hex);
      expect(decode(fromHex(hex))).toEqual(value);
    });
  }

  it("sorts map keys bytewise by encoded form (shorter keys first)", () => {
    expect(toHex(encode({ aa: 3, b: 1, a: 2 }))).toBe("a3616102616201626161" + "03");
  });

  it("omits undefined map values", () => {
    expect(encode({ a: 1, b: undefined })).toEqual(encode({ a: 1 }));
  });

  it("encodes the largest safe integers", () => {
    expect(toHex(encode(Number.MAX_SAFE_INTEGER))).toBe("1b001fffffffffffff");
    expect(toHex(encode(-Number.MAX_SAFE_INTEGER))).toBe("3b001ffffffffffffe");
  });

  it("refuses lone surrogates in text", () => {
    expect(() => encode("\ud800")).toThrow(CborError);
  });

  it("refuses floats and unsafe integers", () => {
    expect(() => encode(1.5)).toThrow(CborError);
    expect(() => encode(Number.MAX_SAFE_INTEGER + 1)).toThrow(CborError);
    expect(() => encode(NaN)).toThrow(CborError);
  });
});

describe("strict decode rejects non-canonical input", () => {
  const bad: [string, string][] = [
    ["1817", "non-shortest uint"],
    ["190017", "non-shortest uint16"],
    ["3817", "non-shortest negint"],
    ["5800", "non-shortest byte length"],
    ["5f4101ff", "indefinite byte string"],
    ["9fff", "indefinite array"],
    ["f93c00", "half float"],
    ["fb3ff8000000000000", "double"],
    ["f7", "undefined"],
    ["e0", "simple value"],
    ["c06161", "tag"],
    ["a2616201616101", "unsorted keys"],
    ["a2616101616102", "duplicate keys"],
    ["a20101616101", "integer key"],
    ["a1410101", "byte-string key"],
    ["0000", "trailing bytes"],
    ["62c328", "invalid UTF-8"],
    ["62c080", "overlong UTF-8"],
    ["63eda080", "UTF-8 surrogate"],
    ["64f4908080", "code point above U+10FFFF"],
    ["61ff", "invalid UTF-8 lead byte"],
    ["1a0000", "truncated"],
    ["9a00010000", "length exceeds input"],
    ["1b0020000000000000", "beyond safe integer"],
  ];
  for (const [hex, why] of bad) {
    it(why, () => expect(() => decode(fromHex(hex))).toThrow(CborError));
  }

  it("rejects excessive nesting", () => {
    expect(() => decode(fromHex("81".repeat(40) + "00"))).toThrow(CborError);
  });

  it("does not let __proto__ keys pollute prototypes", () => {
    const v = decode(encode({ __proto__: 1 } as unknown as CborValue)) as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

const value: fc.Arbitrary<CborValue> = fc.letrec<{ v: CborValue }>((tie) => ({
  v: fc.oneof(
    { depthSize: "small" },
    fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
    fc.string({ unit: "grapheme" }),
    fc.boolean(),
    fc.constant(null),
    fc.uint8Array({ maxLength: 40 }),
    fc.array(tie("v"), { maxLength: 5 }),
    fc.dictionary(fc.string({ unit: "grapheme", maxLength: 6 }), tie("v"), { maxKeys: 5 }),
  ),
})).v;

describe("properties", () => {
  it("decode(encode(v)) == v and re-encoding is identical", () => {
    fc.assert(
      fc.property(value, (v) => {
        const bytes = encode(v);
        const back = decode(bytes);
        expect(back).toEqual(v);
        expect(encode(back)).toEqual(bytes);
      }),
      { numRuns: 2000 },
    );
  });

  it("any byte string either fails to decode or re-encodes to itself", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 24 }), (bytes) => {
        let v: CborValue;
        try {
          v = decode(bytes);
        } catch (e) {
          expect(e).toBeInstanceOf(CborError);
          return;
        }
        expect(encode(v)).toEqual(bytes);
      }),
      { numRuns: 20000 },
    );
  });
});
