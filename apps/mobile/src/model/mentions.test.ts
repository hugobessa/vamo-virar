import { describe, expect, it } from "vitest";
import { extractMentions, findMentions, insertMention, mentionQuery, splitMentions, suggestMentions, type Mentionable } from "./mentions";

const people: Mentionable[] = [
  { member_id: "ana", name: "Ana" },
  { member_id: "anas", name: "Ana Souza" },
  { member_id: "bia", name: "Bia Lima" },
  { member_id: "ze", name: "Zé Ângelo" },
];

describe("the mention being typed", () => {
  it("is the @ at the start or after a space, up to the caret", () => {
    expect(mentionQuery("@an", 3)).toEqual({ start: 0, query: "an" });
    expect(mentionQuery("oi @Ana S", 9)).toEqual({ start: 3, query: "Ana S" });
    expect(mentionQuery("oi @", 4)).toEqual({ start: 3, query: "" });
    expect(mentionQuery("oi @ana", 5)).toEqual({ start: 3, query: "a" });
  });

  it("is not an email, a line break away, or nothing at all", () => {
    expect(mentionQuery("ana@x.org", 9)).toBeNull();
    expect(mentionQuery("@ana\nfoo", 8)).toBeNull();
    expect(mentionQuery("sem arroba", 10)).toBeNull();
  });
});

describe("suggestions", () => {
  it("match the start of the name or of any of its words, ignoring case and accents", () => {
    expect(suggestMentions(people, "an").map((p) => p.member_id)).toEqual(["ana", "anas", "ze"]); // "Ângelo" too
    expect(suggestMentions(people, "lima").map((p) => p.member_id)).toEqual(["bia"]);
    expect(suggestMentions(people, "ze").map((p) => p.member_id)).toEqual(["ze"]);
    expect(suggestMentions(people, "ANGELO").map((p) => p.member_id)).toEqual(["ze"]);
    expect(suggestMentions(people, "").map((p) => p.member_id)).toEqual(["ana", "anas", "bia", "ze"]);
    expect(suggestMentions(people, "", 2)).toHaveLength(2);
    expect(suggestMentions(people, "x")).toEqual([]);
  });
});

describe("inserting a pick", () => {
  it("replaces what was typed with the full name and a space, keeping the rest", () => {
    expect(insertMention("oi @bi, tudo bem?", 6, "Bia Lima")).toEqual({ text: "oi @Bia Lima , tudo bem?", caret: 13 });
    expect(insertMention("@", 1, "Ana")).toEqual({ text: "@Ana ", caret: 5 });
    expect(insertMention("nada aqui", 4, "Ana")).toEqual({ text: "nada aqui", caret: 4 });
  });
});

describe("reading mentions back", () => {
  it("prefers the longest name, ignores case and accents, and wants a word boundary", () => {
    expect(extractMentions("@Ana Souza e @ana levam; @ze ângelo não", people)).toEqual(["ana", "anas", "ze"]);
    expect(extractMentions("@Ana, vem? (@Bia Lima)", people)).toEqual(["ana", "bia"]);
    expect(extractMentions("@Anabela não existe; x@Ana também não; @Anas", people)).toEqual([]);
    expect(extractMentions("@Ana Souza.", people)).toEqual(["anas"]);
  });

  it("gives positions in characters, not bytes, so accented text lines up", () => {
    const text = "Ôi @Zé Ângelo!";
    expect(findMentions(text, people)).toEqual([{ start: 3, end: 13, person: people[3] }]);
    expect(splitMentions(text, people)).toEqual([{ text: "Ôi " }, { text: "@Zé Ângelo", mention: people[3] }, { text: "!" }]);
  });

  it("splits text for rendering, mentions and plain pieces alternating", () => {
    expect(splitMentions("sem ninguém", people)).toEqual([{ text: "sem ninguém" }]);
    expect(splitMentions("@Ana @Bia Lima", people)).toEqual([{ text: "@Ana", mention: people[0] }, { text: " " }, { text: "@Bia Lima", mention: people[2] }]);
  });
});
