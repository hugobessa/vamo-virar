// Strict UTF-8, without TextEncoder/TextDecoder (not reliably present in
// React Native's Hermes, and the decoder must be strict: no overlong forms,
// no surrogates, nothing above U+10FFFF).

export function encodeUtf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) throw new Error("lone surrogate");
      c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new Error("lone surrogate");
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function decodeUtf8(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; ) {
    const c = b[i]!;
    let cp: number;
    let n: number;
    let min: number;
    if (c < 0x80) {
      s += String.fromCharCode(c);
      i++;
      continue;
    } else if ((c & 0xe0) === 0xc0) {
      cp = c & 0x1f;
      n = 1;
      min = 0x80;
    } else if ((c & 0xf0) === 0xe0) {
      cp = c & 0x0f;
      n = 2;
      min = 0x800;
    } else if ((c & 0xf8) === 0xf0) {
      cp = c & 0x07;
      n = 3;
      min = 0x10000;
    } else {
      throw new Error("invalid UTF-8 lead byte");
    }
    for (let k = 1; k <= n; k++) {
      const cc = b[i + k];
      if (cc === undefined || (cc & 0xc0) !== 0x80) throw new Error("invalid UTF-8 continuation");
      cp = (cp << 6) | (cc & 0x3f);
    }
    if (cp < min) throw new Error("overlong UTF-8");
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new Error("invalid code point");
    s += String.fromCodePoint(cp);
    i += n + 1;
  }
  return s;
}
