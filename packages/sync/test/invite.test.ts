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

  it("point to the web app, with the invite in the fragment", () => {
    const link = inviteLink({ cid, node: "https://servidor.vamovirar.app", ik });
    expect(link).toBe(`https://web.vamovirar.app/join#c=${"01".repeat(32)}&n=https%3A%2F%2Fservidor.vamovirar.app&k=${"02".repeat(32)}`);
    expect(inviteLink({ cid, node: "https://n.example", ik }, "http://127.0.0.1:8081/join")).toMatch(/^http:\/\/127\.0\.0\.1:8081\/join#c=/);
  });

  it("accept the app scheme, https links on any host, and a query instead of a fragment", () => {
    const q = `c=${"01".repeat(32)}&n=https%3A%2F%2Fn.example&k=${"02".repeat(32)}`;
    const want = { cid, node: "https://n.example", ik };
    expect(parseInvite(`vamovirar://join?${q}`)).toEqual(want);
    expect(parseInvite(`https://web.vamovirar.app/join#${q}`)).toEqual(want);
    expect(parseInvite(`https://outro.example/join/?${q}`)).toEqual(want);
    expect(() => parseInvite(`http://web.vamovirar.app/join#${q}`)).toThrow(/not a vamo-virar invite/);
    expect(() => parseInvite(`https://web.vamovirar.app/outra#${q}`)).toThrow(/not a vamo-virar invite/);
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

  it("a ping says only why, and only one of the known reasons", () => {
    const me = generateEncryptionKeyPair();
    const ct = sealMail(cid, me.pk, { kind: "ping", what: "mention" });
    expect(openMail(cid, "ping", me, ct)).toEqual({ kind: "ping", what: "mention" });
    const bogus = sealMail(cid, me.pk, { kind: "ping", what: "spam" as never });
    expect(openMail(cid, "ping", me, bogus)).toBeNull();
  });
});
