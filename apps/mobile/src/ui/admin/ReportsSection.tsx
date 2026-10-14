// "Denúncias": what members reported, with the two things to do about each.

import { canModerate, isAdmin, type MemberRecord } from "@vamo-virar/domain";
import type { MemberReport } from "@vamo-virar/sync";
import { View } from "react-native";
import { confirm } from "../../lib/confirm";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import type { StringKey } from "../../model/i18n";
import { Body, Button, Card, Chip, Heading } from "../kit";
import { useLayout } from "../layout";
import { space } from "../theme";
import type { AdminRunner } from "./hooks";

export function ReportsSection({ entry, runner }: { entry: CommunityEntry; runner: AdminRunner }) {
  const { t, store, locale } = useApp();
  const l = useLayout();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const admin = !!me && isAdmin(state, me);
  const mod = !!me && canModerate(state, me);
  const reports: readonly MemberReport[] = r.reports;
  const nameOf = (id: string) => state.members[id]?.profile?.display_name ?? t("formerMember");
  const mayBlock = (m: MemberRecord) => admin || (mod && !canModerate(state, m));
  const { busy, run } = runner;
  return (
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
                <View style={l.compact ? { flex: 1 } : null}>
                  <Button
                    testID={`report-block-${rep.reportId}`}
                    kind="danger"
                    label={t("block")}
                    busy={busy === `blk${rep.memberId}`}
                    onPress={async () => {
                      if (await confirm(t("blockConfirm"), t("yes"), t("no"))) await run(`blk${rep.memberId}`, (x) => x.blockMember(rep.memberId));
                    }}
                  />
                </View>
              ) : null}
              <View style={l.compact ? { flex: 1 } : null}>
                <Button kind="secondary" label={t("dismiss")} onPress={() => void store.admin(entry.id, async (x) => x.dismissReport(rep.reportId))} />
              </View>
            </View>
          </Card>
        );
      })}
    </>
  );
}
