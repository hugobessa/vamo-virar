import { toHex, utf8 } from "@vamo-virar/protocol";
import { describe, expect, it } from "vitest";
import {
  formatLinkCode,
  generateLinkCode,
  LINK_CODE_CHARS,
  linkKey,
  linkRendezvous,
  normalizeLinkCode,
  openLinkBundle,
  sealLinkBundle,
} from "../src/link.js";
import { mailboxId } from "../src/keys.js";
import { flipBit, seededRng } from "./helpers.js";

const rng = seededRng("link");
const cid = new Uint8Array(32).fill(7);
const secret = new Uint8Array(32).fill(9);

describe("link codes", () => {
  it("are 10 Crockford characters", () => {
    for (let i = 0; i < 50; i++) {
      const c = generateLinkCode(rng);
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
      expect(normalizeLinkCode(c)).toBe(c);
    }
  });

  it("survive being retyped", () => {
    expect(formatLinkCode("K7QM2XRA9P")).toBe("K7QM-2XRA-9P");
    expect(normalizeLinkCode(" k7qm-2xra 9p ")).toBe("K7QM2XRA9P");
    expect(normalizeLinkCode("OIL0000000")).toBe("0110000000");
    expect(normalizeLinkCode("K7QM2XRA9")).toBeNull();
    expect(normalizeLinkCode("K7QM2XRA9U")).toBeNull(); // U is not in the alphabet
    expect("X".repeat(LINK_CODE_CHARS)).toHaveLength(10);
  });
});

describe("link bundle", () => {
  it("derives a fixed rendezvous and key from secret, code and community (known answer)", async () => {
    const r = linkRendezvous(cid, secret);
    expect(r.mailbox).toEqual(mailboxId(cid, r.key.pk));
    expect(toHex(r.key.pk)).toBe("c0b1af8d6e5112380584d7b8b82bba88f59b805c14c5b455c8c6308b722dbc0c");
    // Locks the derivation: another client must produce the same bytes.
    expect(toHex(await linkKey(cid, secret, "K7QM2XRA9P"))).toBe("0c08164af74a21f41f00b22842f571184cac36276fc7628ffaf080161507edde");
  });

  it("opens only with the same secret, code and community", async () => {
    const key = await linkKey(cid, secret, "k7qm-2xra-9p");
    expect(key).toEqual(await linkKey(cid, secret, "K7QM2XRA9P"));
    const sealed = sealLinkBundle(key, cid, utf8("keys"), rng);
    expect(openLinkBundle(key, cid, sealed)).toEqual(utf8("keys"));
    expect(openLinkBundle(await linkKey(cid, secret, "K7QM2XRA9Q"), cid, sealed)).toBeNull();
    expect(openLinkBundle(await linkKey(cid, flipBit(secret), "K7QM2XRA9P"), cid, sealed)).toBeNull();
    expect(openLinkBundle(key, flipBit(cid), sealed)).toBeNull();
    expect(openLinkBundle(key, cid, flipBit(sealed, 40))).toBeNull();
    expect(openLinkBundle(key, cid, sealed.subarray(0, 30))).toBeNull();
  });

  it("refuses something that is not a code", async () => {
    await expect(linkKey(cid, secret, "abc")).rejects.toThrow(/link code/);
  });
});
