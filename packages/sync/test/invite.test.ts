import { generateEncryptionKeyPair } from "@vamo-virar/crypto";
import { describe, expect, it } from "vitest";
import { inviteLink, openMail, parseInvite, sealMail } from "../src/invite.js";

const cid = new Uint8Array(32).fill(1);
const ik = new Uint8Array(32).fill(2);

describe("invite links", () => {
  it("round-trip, with and without a secret", () => {
    const secret = new Uint8Array(32).fill(3);
    const node = "https://node.example.org:8443/base";
    expect(parseInvite(inviteLink({ cid, node, ik, secret }))).toEqual({ cid, node, ik, secret });
    expect(parseInvite(inviteLink({ cid, node, ik }))).toEqual({ cid, node, ik });
  });

  it("reject malformed links", () => {
    expect(() => parseInvite("https://evil.example/join?c=00")).toThrow();
    expect(() => parseInvite(`vamovirar://join?c=${"00".repeat(31)}&n=https%3A%2F%2Fx&k=${"00".repeat(32)}`)).toThrow();
    expect(() => parseInvite(`vamovirar://join?c=${"00".repeat(32)}&n=javascript%3Aalert(1)&k=${"00".repeat(32)}`)).toThrow();
    expect(() => parseInvite(`vamovirar://join?c=${"00".repeat(32)}&k=${"00".repeat(32)}`)).toThrow(/missing n/);
  });
});

describe("sealed mail", () => {
  it("opens only for the recipient, kind and community it was sealed for", () => {
    const me = generateEncryptionKeyPair();
    const other = generateEncryptionKeyPair();
    const ct = sealMail(cid, me.pk, { kind: "removed", reason: "saiu" });
    expect(openMail(cid, "removed", me, ct)).toEqual({ kind: "removed", reason: "saiu" });
    expect(openMail(cid, "removed", other, ct)).toBeNull();
    expect(openMail(cid, "join_result", me, ct)).toBeNull();
    expect(openMail(new Uint8Array(32), "removed", me, ct)).toBeNull();
    const ik2 = sealMail(cid, me.pk, { kind: "ik_env", ik_sk: new Uint8Array(32).fill(9) });
    expect(openMail(cid, "ik_env", me, ik2)).toEqual({ kind: "ik_env", ik_sk: new Uint8Array(32).fill(9) });
    expect(openMail(cid, "ik_env", me, new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
