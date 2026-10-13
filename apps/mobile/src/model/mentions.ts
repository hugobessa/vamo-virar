// `@` mentions in comments: finding the name being typed, offering people,
// inserting the pick, and turning the finished text back into member ids
// (what the op carries, protocol.md §9.7) and into highlighted pieces.
//
// A mention is `@` followed by a member's display name as it is, spaces
// included ("@Ana Souza"). Matching ignores case and accents, longest name
// first, so "@Ana" never claims "@Ana Souza".

import type { CommunityState, MemberRecord } from "@vamo-virar/domain";

export interface Mentionable {
  member_id: string;
  name: string;
}

/** People one may mention: active members with a name, other than oneself, by name. */
export function mentionables(state: CommunityState, me: MemberRecord | undefined): Mentionable[] {
  return Object.values(state.members)
    .filter((m) => m.status === "active" && m.member_id !== me?.member_id && !!m.profile?.display_name.trim())
    .map((m) => ({ member_id: m.member_id, name: m.profile!.display_name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Lowercase, accents stripped, spaces collapsed: how names compare. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The mention being typed at `caret`: an `@` at the start or after a space,
 * then the text up to the caret (spaces allowed, so two-word names work),
 * as long as the text is not already a complete mention.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > 40) return null;
  return { start: at, query };
}

/** People whose name, or one of its words, starts with what was typed. */
export function suggestMentions(people: Mentionable[], query: string, limit = 5): Mentionable[] {
  const q = fold(query);
  const hits = people.filter((p) => {
    const name = fold(p.name);
    return q === "" || name.startsWith(q) || name.split(" ").some((w) => w.startsWith(q));
  });
  return hits.slice(0, limit);
}

/** Replaces the mention being typed at `caret` with `@Name ` and says where the caret lands. */
export function insertMention(text: string, caret: number, name: string): { text: string; caret: number } {
  const q = mentionQuery(text, caret);
  if (!q) return { text, caret };
  const head = `${text.slice(0, q.start)}@${name} `;
  return { text: head + text.slice(caret), caret: head.length };
}

const boundaryBefore = (text: string, i: number) => i === 0 || /[\s(["'“‘]/.test(text[i - 1]!);
const boundaryAfter = (text: string, i: number) => i >= text.length || /[\s.,;:!?)\]"'”’]/.test(text[i]!);

/** Every `@Name` in the text, as the people it names, longest names first. */
export function findMentions(text: string, people: Mentionable[]): { start: number; end: number; person: Mentionable }[] {
  const out: { start: number; end: number; person: Mentionable }[] = [];
  const folded = fold(text);
  // Folding keeps length only for the characters we strip (combining marks); work on a
  // per-character folded copy instead so indexes line up with the original text.
  const chars = [...text].map((ch) => fold(ch) || ch);
  void folded;
  const taken = new Array<boolean>(chars.length).fill(false);
  for (const person of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const needle = [...`@${fold(person.name)}`];
    for (let i = 0; i + needle.length <= chars.length; i++) {
      if (chars[i] !== "@" || taken[i] || !boundaryBefore(text, i)) continue;
      let ok = true;
      for (let j = 0; j < needle.length; j++) {
        if (chars[i + j] !== needle[j] || taken[i + j]) {
          ok = false;
          break;
        }
      }
      if (!ok || !boundaryAfter(chars.join(""), i + needle.length)) continue;
      for (let j = 0; j < needle.length; j++) taken[i + j] = true;
      out.push({ start: i, end: i + needle.length, person });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The member ids a finished comment mentions: what `task.comment` carries. */
export function extractMentions(text: string, people: Mentionable[]): string[] {
  return [...new Set(findMentions(text, people).map((m) => m.person.member_id))].sort();
}

/** The text cut into plain pieces and mentions, for rendering. */
export function splitMentions(text: string, people: Mentionable[]): { text: string; mention?: Mentionable }[] {
  const out: { text: string; mention?: Mentionable }[] = [];
  const chars = [...text];
  let at = 0;
  for (const m of findMentions(text, people)) {
    if (m.start > at) out.push({ text: chars.slice(at, m.start).join("") });
    out.push({ text: chars.slice(m.start, m.end).join(""), mention: m.person });
    at = m.end;
  }
  if (at < chars.length) out.push({ text: chars.slice(at).join("") });
  return out;
}
