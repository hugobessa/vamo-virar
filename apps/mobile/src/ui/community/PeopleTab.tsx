import { canModerate, isAdmin, isModerator, type MemberRecord } from "@vamo-virar/domain";
import type { MemberReport, PendingJoin, ReportReason } from "@vamo-virar/sync";
import { useCallback, useEffect, useState } from "react";
import { LayoutAnimation, Share, Text, View } from "react-native";
import { confirm } from "../../lib/confirm";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { roleKey } from "../../model/events";
import { Banner, Body, Button, Card, Chip, Enter, Heading } from "../kit";
import { motion, space, useReducedMotion, useTheme } from "../theme";
import { errorText } from "../../model/errors";
import type { StringKey } from "../../model/i18n";
import { ReportForm } from "./ReportForm";

export function PeopleTab({ entry }: { entry: CommunityEntry }) {
  const { t, store, locale } = useApp();
  const c = useTheme();
  const reduced = useReducedMotion();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const admin = !!me && isAdmin(state, me);
  /** Admins and moderators: join requests, reports, blocking. */
  const mod = !!me && canModerate(state, me);
  const [requests, setRequests] = useState<PendingJoin[] | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!mod) return;
    try {
      setRequests(await r.joinRequests());
    } catch {
      setRequests(null);
    }
  }, [mod, r]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function run(key: string, f: () => Promise<unknown>): Promise<boolean> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await store.admin(entry.id, f);
      // A handled request slides out of the list and the person appears below.
      if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      await loadRequests();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function sendReport(memberId: string, reason: ReportReason, details: string) {
    if (await run(`rep${memberId}`, () => r.reportMember(memberId, reason, details))) {
      setReporting(null);
      setNotice(t("reportSent"));
    }
  }

  async function block(memberId: string) {
    if (await confirm(t("blockConfirm"), t("yes"), t("no"))) await run(`blk${memberId}`, () => r.blockMember(memberId));
  }

  const members = Object.values(state.members)
    .filter((m) => m.status === "active")
    .sort((a, b) => (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? ""));

  const nameOf = (id: string) => state.members[id]?.profile?.display_name ?? t("formerMember");
  const reports: readonly MemberReport[] = mod ? r.reports : [];
  // Moderators block members and organizers; only admins block admins and moderators.
  const mayBlock = (m: MemberRecord) => admin || (mod && !canModerate(state, m));
  const blockedMembers = Object.values(state.members)
    .filter((m) => m.blocked)
    .sort((a, b) => nameOf(a.member_id).localeCompare(nameOf(b.member_id)));
  const canReport = me?.status === "active";

  const profileName = (p: unknown) => (p && typeof p === "object" && "display_name" in p ? String((p as { display_name: unknown }).display_name) : "?");

  return (
    <>
      {error ? <Banner tone="danger" text={error} /> : null}
      {notice ? <Banner tone="ok" text={notice} /> : null}
      {mod ? (
        <>
          <Heading>{t("reports")}</Heading>
          {reports.length === 0 ? <Body muted>{t("noReports")}</Body> : null}
          {reports.map((rep) => {
            const target = state.members[rep.memberId];
            return (
              <Card key={rep.reportId} testID={`report-${rep.reportId}`}>
                <Body>{nameOf(rep.memberId)}</Body>
                <Chip tone="danger" label={t(`reason_${rep.reason}` as StringKey)} />
                {rep.details ? <Body>{rep.details}</Body> : null}
                <Body muted>{`${t("reportedBy")} ${nameOf(rep.reporter)} · ${new Date(rep.receivedAt).toLocaleDateString(locale)}`}</Body>
                {target?.blocked ? <Chip label={t("blocked")} /> : null}
                <View style={{ flexDirection: "row", gap: space.s }}>
                  {target && !target.blocked && target.member_id !== r.memberId && mayBlock(target) ? (
                    <View style={{ flex: 1 }}>
                      <Button testID={`report-block-${rep.reportId}`} kind="danger" label={t("block")} busy={busy === `blk${rep.memberId}`} onPress={() => block(rep.memberId)} />
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Button kind="secondary" label={t("dismiss")} onPress={() => void store.admin(entry.id, async (x) => x.dismissReport(rep.reportId))} />
                  </View>
                </View>
              </Card>
            );
          })}
          <Heading>{t("joinRequests")}</Heading>
          {requests === null || requests.length === 0 ? <Body muted>{t("noRequests")}</Body> : null}
          {requests?.map((p, i) => (
            <Enter key={p.intakeId} delay={i * motion.stagger}>
              <Card testID={`request-${p.intakeId}`}>
                <Body>{profileName(p.request.profile)}</Body>
                {p.request.message ? <Body muted>{p.request.message}</Body> : null}
                <View style={{ flexDirection: "row", gap: space.s }}>
                  <View style={{ flex: 1 }}>
                    <Button testID={`approve-${p.intakeId}`} label={t("accepted")} haptic="confirm" busy={busy === `a${p.intakeId}`} onPress={() => run(`a${p.intakeId}`, () => r.approve(p))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button kind="secondary" label={t("refuse")} busy={busy === `r${p.intakeId}`} onPress={() => run(`r${p.intakeId}`, () => r.reject(p))} />
                  </View>
                </View>
              </Card>
            </Enter>
          ))}
          {admin ? (
            <Button
              testID="create-invite"
              kind="secondary"
              label={t("createInvite")}
              busy={busy === "invite"}
              onPress={() =>
                run("invite", async () => {
                  setInvite(await r.createInvite({ maxUses: 1 }));
                })
              }
            />
          ) : null}
          {invite ? (
            <Card>
              <Text testID="invite-text" selectable style={{ color: c.text }}>
                {invite}
              </Text>
              <Body muted>{t("inviteOnce")}</Body>
              <Button label={t("shareInvite")} onPress={() => void Share.share({ message: invite })} />
            </Card>
          ) : null}
        </>
      ) : null}
      <Heading>{t("tabPeople")}</Heading>
      {members.map((m: MemberRecord) => (
        <Card key={m.member_id} testID={`member-${m.member_id}`}>
          <Body>{m.profile?.display_name ?? "?"}</Body>
          <Chip label={t(roleKey(state, m))} />
          {reporting === m.member_id ? (
            <ReportForm
              name={m.profile?.display_name ?? "?"}
              busy={busy === `rep${m.member_id}`}
              onSend={(reason, details) => void sendReport(m.member_id, reason, details)}
              onCancel={() => setReporting(null)}
            />
          ) : m.member_id !== r.memberId && (mod || canReport) ? (
            <View style={{ gap: space.s }}>
              {admin && m.role === "member" ? (
                <Button kind="secondary" label={t("makeOrganizer")} onPress={() => store.submit(entry.id, "member.role", { member_id: m.member_id, role: "organizer" })} />
              ) : null}
              {admin && !isAdmin(state, m) ? (
                <Button kind="secondary" label={t("makeAdmin")} busy={busy === `adm${m.member_id}`} onPress={() => run(`adm${m.member_id}`, () => r.makeAdmin(m.member_id))} />
              ) : null}
              {admin && !isAdmin(state, m) && !isModerator(state, m) ? (
                <Button testID={`make-mod-${m.member_id}`} kind="secondary" label={t("makeModerator")} busy={busy === `mod${m.member_id}`} onPress={() => run(`mod${m.member_id}`, () => r.makeModerator(m.member_id))} />
              ) : null}
              {admin && isModerator(state, m) ? (
                <Button
                  kind="secondary"
                  label={t("removeModerator")}
                  busy={busy === `unmod${m.member_id}`}
                  onPress={async () => {
                    if (await confirm(t("removeModeratorConfirm"), t("yes"), t("no"))) await run(`unmod${m.member_id}`, () => r.removeModerator(m.member_id));
                  }}
                />
              ) : null}
              {canReport ? (
                <Button
                  testID={`report-${m.member_id}`}
                  kind="secondary"
                  label={t("report")}
                  onPress={() => {
                    setNotice(null);
                    setReporting(m.member_id);
                  }}
                />
              ) : null}
              {admin ? (
                <Button
                  kind="danger"
                  label={t("remove")}
                  busy={busy === `rm${m.member_id}`}
                  onPress={async () => {
                    if (await confirm(t("removeConfirm"), t("yes"), t("no"))) await run(`rm${m.member_id}`, () => r.removeMember(m.member_id));
                  }}
                />
              ) : null}
              {mayBlock(m) ? (
                <Button testID={`block-${m.member_id}`} kind="danger" label={t("block")} busy={busy === `blk${m.member_id}`} onPress={() => block(m.member_id)} />
              ) : null}
            </View>
          ) : null}
        </Card>
      ))}
      {mod ? (
        <>
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
                  if (await confirm(t("unblockConfirm"), t("yes"), t("no"))) await run(`unb${m.member_id}`, () => r.unblockMember(m.member_id));
                }}
              />
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}
