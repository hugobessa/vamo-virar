// "Pessoas" for the coordination: every member with their role, a menu of
// what to do with them (roles, removal, blocking), and the blocked list.

import { canModerate, isAdmin, isModerator, type MemberRecord } from "@vamo-virar/domain";
import { useState } from "react";
import { View } from "react-native";
import { confirm } from "../../lib/confirm";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { roleKey } from "../../model/events";
import { fill } from "../../model/i18n";
import { Body, Button, Card, Chip, Grid, Heading, MenuItem, MoreButton, Sheet } from "../kit";
import { useLayout } from "../layout";
import { space } from "../theme";
import type { AdminRunner } from "./hooks";

export function PeopleSection({ entry, runner }: { entry: CommunityEntry; runner: AdminRunner }) {
  const { t, store } = useApp();
  const l = useLayout();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const admin = !!me && isAdmin(state, me);
  const mod = !!me && canModerate(state, me);
  const [menu, setMenu] = useState<string | null>(null);
  const { busy, run } = runner;

  const members = Object.values(state.members)
    .filter((m) => m.status === "active")
    .sort((a, b) => (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? ""));
  const nameOf = (id: string) => state.members[id]?.profile?.display_name ?? t("formerMember");
  // Moderators block members and organizers; only admins block admins and moderators.
  const mayBlock = (m: MemberRecord) => admin || (mod && !canModerate(state, m));
  const blockedMembers = Object.values(state.members)
    .filter((m) => m.blocked)
    .sort((a, b) => nameOf(a.member_id).localeCompare(nameOf(b.member_id)));

  /** What may be done with one person, in the menu. */
  const itemsFor = (m: MemberRecord): { key: string; label: string; danger?: boolean; run: () => void }[] => {
    if (m.member_id === r.memberId) return [];
    const items: { key: string; label: string; danger?: boolean; run: () => void }[] = [];
    if (admin && m.role === "member") items.push({ key: `org-${m.member_id}`, label: t("makeOrganizer"), run: () => store.submit(entry.id, "member.role", { member_id: m.member_id, role: "organizer" }) });
    if (admin && !isAdmin(state, m)) items.push({ key: `adm-${m.member_id}`, label: t("makeAdmin"), run: () => void run(`adm${m.member_id}`, (x) => x.makeAdmin(m.member_id)) });
    if (admin && !isAdmin(state, m) && !isModerator(state, m)) items.push({ key: `make-mod-${m.member_id}`, label: t("makeModerator"), run: () => void run(`mod${m.member_id}`, (x) => x.makeModerator(m.member_id)) });
    if (admin && isModerator(state, m)) {
      items.push({
        key: `unmod-${m.member_id}`,
        label: t("removeModerator"),
        run: async () => {
          if (await confirm(t("removeModeratorConfirm"), t("yes"), t("no"))) await run(`unmod${m.member_id}`, (x) => x.removeModerator(m.member_id));
        },
      });
    }
    if (admin) {
      items.push({
        key: `remove-${m.member_id}`,
        label: t("remove"),
        danger: true,
        run: async () => {
          if (await confirm(t("removeConfirm"), t("yes"), t("no"))) await run(`rm${m.member_id}`, (x) => x.removeMember(m.member_id));
        },
      });
    }
    if (mayBlock(m)) {
      items.push({
        key: `block-${m.member_id}`,
        label: t("block"),
        danger: true,
        run: async () => {
          if (await confirm(t("blockConfirm"), t("yes"), t("no"))) await run(`blk${m.member_id}`, (x) => x.blockMember(m.member_id));
        },
      });
    }
    return items;
  };
  const open = members.find((m) => m.member_id === menu);

  return (
    <>
      <Body muted>{t("adminPeopleHelp")}</Body>
      <Heading>{fill(t("memberCount"), { n: members.length })}</Heading>
      <Grid columns={l.listColumns}>
        {members.map((m) => {
          const items = itemsFor(m);
          const working = busy !== null && busy.endsWith(m.member_id);
          return (
            <Card key={m.member_id} testID={`member-${m.member_id}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
                <View style={{ flex: 1, gap: space.xs }}>
                  <Body>{m.profile?.display_name ?? "?"}</Body>
                  <Chip label={t(roleKey(state, m))} />
                </View>
                {items.length > 0 ? <MoreButton testID={`member-menu-${m.member_id}`} label={`${t("memberActions")}: ${m.profile?.display_name ?? "?"}`} onPress={() => setMenu(m.member_id)} /> : null}
              </View>
              {working ? <Body muted>…</Body> : null}
            </Card>
          );
        })}
      </Grid>

      <Heading>{t("blockedPeople")}</Heading>
      {blockedMembers.length === 0 ? <Body muted>{t("noBlocked")}</Body> : null}
      {blockedMembers.map((m) => (
        <Card key={m.member_id} testID={`blocked-${m.member_id}`}>
          <Body>{nameOf(m.member_id)}</Body>
          <Button
            kind="secondary"
            label={t("unblock")}
            busy={busy === `unb${m.member_id}`}
            onPress={async () => {
              if (await confirm(t("unblockConfirm"), t("yes"), t("no"))) await run(`unb${m.member_id}`, (x) => x.unblockMember(m.member_id));
            }}
          />
        </Card>
      ))}

      <Sheet visible={!!open} onClose={() => setMenu(null)} title={open?.profile?.display_name ?? ""} testID="member-menu-sheet">
        {open
          ? itemsFor(open).map((it) => (
              <MenuItem
                key={it.key}
                testID={it.key}
                label={it.label}
                danger={it.danger}
                onPress={() => {
                  setMenu(null);
                  it.run();
                }}
              />
            ))
          : null}
      </Sheet>
    </>
  );
}
