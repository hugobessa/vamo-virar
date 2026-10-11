import { utf8 } from "@vamo-virar/protocol";
import { describe, expect, it } from "vitest";
import { blobIdOf, MAX_BLOB_PLAINTEXT, openBlob, sealBlob } from "../src/blob.js";
import { flipBit, seededRng } from "./helpers.js";

const rng = seededRng("blob");

describe("blobs", () => {
  it("round-trips and names the blob by its ciphertext", () => {
    const file = utf8("panfleto.pdf bytes");
    const b = sealBlob(file, rng);
    expect(b.blobId).toEqual(blobIdOf(b.ct));
    expect(openBlob(b, b.ct)).toEqual(file);
  });

  it("refuses a different file, a tampered one, or the wrong key", () => {
    const b = sealBlob(utf8("a"), rng);
    const other = sealBlob(utf8("b"), rng);
    expect(openBlob(b, other.ct)).toBeNull();
    expect(openBlob(b, flipBit(b.ct))).toBeNull();
    // Same bytes, wrong key: the hash matches, the AEAD does not.
    expect(openBlob({ ...b, key: other.key }, b.ct)).toBeNull();
  });

  it("uses a fresh key and nonce per file", () => {
    const a = sealBlob(utf8("x"), rng);
    const b = sealBlob(utf8("x"), rng);
    expect(a.key).not.toEqual(b.key);
    expect(a.nonce).not.toEqual(b.nonce);
    expect(a.blobId).not.toEqual(b.blobId);
  });

  it("caps the plaintext", () => {
    expect(() => sealBlob(new Uint8Array(MAX_BLOB_PLAINTEXT + 1), rng)).toThrow(/too large/);
  });
});
