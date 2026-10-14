// Who is in the community, for everyone: names and roles, and the one thing
// a member may do about another person, which is to report them to the
// coordination. Letting people in, roles and blocking live on the
// administration screen.

import type { MemberRecord } from "@vamo-virar/domain";
import type { ReportReason } from "@vamo-virar/sync";
import { useState } from "react";
import { View } from "react-native";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { errorText } from "../../model/errors";
import { roleKey } from "../../model/events";
import { fill } from "../../model/i18n";
import { Banner, Body, Button, Card, Chip, Grid, Heading } from "../kit";
import { useLayout } from "../layout";
import { space } from "../theme";
import { ReportForm } from "./ReportForm";

export function PeopleTab({ entry }: { entry: CommunityEntry }) {
  const { t, store } = useApp();
  const l = useLayout();
  const r = entry.replica;
  const state = r.view!;
  const me = state.members[r.memberId];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);

  const members = Object.values(state.members)
    .filter((m) => m.status === "active")
    .sort((a, b) => (a.profile?.display_name ?? "").localeCompare(b.profile?.display_name ?? ""));
  const canReport = me?.status === "active";

  async function sendReport(memberId: string, reason: ReportReason, details: string) {
    setBusy(`rep${memberId}`);
    setError(null);
    setNotice(null);
    try {
      await store.admin(entry.id, () => r.reportMember(memberId, reason, details));
      setReporting(null);
      setNotice(t("reportSent"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error ? <Banner tone="danger" text={error} /> : null}
      {notice ? <Banner tone="ok" text={notice} /> : null}
      <Heading>{fill(t("memberCount"), { n: members.length })}</Heading>
      <Body muted>{t("peopleIntro")}</Body>
      {/* The person being reported gets the whole width for the form. */}
      <Grid columns={reporting ? 1 : l.listColumns}>
        {members.map((m: MemberRecord) => (
          <Card key={m.member_id} testID={`member-${m.member_id}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Body>{m.profile?.display_name ?? "?"}</Body>
                <Chip label={t(roleKey(state, m))} />
              </View>
              {reporting !== m.member_id && m.member_id !== r.memberId && canReport ? (
                <Button
                  testID={`report-${m.member_id}`}
                  kind="secondary"
                  compact
                  label={t("report")}
                  onPress={() => {
                    setNotice(null);
                    setReporting(m.member_id);
                  }}
                />
              ) : null}
            </View>
            {reporting === m.member_id ? (
              <ReportForm
                name={m.profile?.display_name ?? "?"}
                busy={busy === `rep${m.member_id}`}
                onSend={(reason, details) => void sendReport(m.member_id, reason, details)}
                onCancel={() => setReporting(null)}
              />
            ) : null}
          </Card>
        ))}
      </Grid>
    </>
  );
}
