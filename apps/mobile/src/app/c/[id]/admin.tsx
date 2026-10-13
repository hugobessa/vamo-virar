// The administration of a community, for the coordination and the
// moderation only: who is asking to join, who does what, what was reported,
// and (admins) the community's own settings. Members never see this screen;
// their tabs show only what concerns them.

import { canModerate, isAdmin } from "@vamo-virar/domain";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useApp, useCommunity } from "../../../lib/context";
import type { CommunityEntry } from "../../../lib/store";
import { CommunitySection } from "../../../ui/admin/CommunitySection";
import { useAdminRunner, useJoinRequests } from "../../../ui/admin/hooks";
import { IntakeSection } from "../../../ui/admin/IntakeSection";
import { PeopleSection } from "../../../ui/admin/PeopleSection";
import { ReportsSection } from "../../../ui/admin/ReportsSection";
import { DisabledScope } from "../../../ui/community/Disabled";
import { Banner, Body, Screen, Segmented, Title } from "../../../ui/kit";

export type AdminSection = "intake" | "people" | "reports" | "community";
const SECTIONS: readonly AdminSection[] = ["intake", "people", "reports", "community"];

export default function AdminScreen() {
  const { id, section } = useLocalSearchParams<{ id: string; section?: string }>();
  const { t } = useApp();
  const entry = useCommunity(id);
  const state = entry?.replica.view;
  const me = entry && state ? state.members[entry.replica.memberId] : undefined;
  if (!entry || !state || !me || !canModerate(state, me)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t("adminTitle") }} />
        <Body muted>{t("why_not_authorized")}</Body>
      </Screen>
    );
  }
  return <Admin entry={entry} admin={isAdmin(state, me)} initial={SECTIONS.includes(section as AdminSection) ? (section as AdminSection) : "intake"} />;
}

function Admin({ entry, admin, initial }: { entry: CommunityEntry; admin: boolean; initial: AdminSection }) {
  const { t, store } = useApp();
  const state = entry.replica.view!;
  const [section, setSection] = useState<AdminSection>(initial === "community" && !admin ? "intake" : initial);
  const runner = useAdminRunner(entry);
  const { requests, reload } = useJoinRequests(entry, true);
  const pendingRequests = requests?.length ?? 0;
  const reports = entry.replica.reports.length;
  return (
    <Screen
      width="board"
      onRefresh={async () => {
        await store.syncOne(entry.id);
        await reload();
      }}
    >
      <Stack.Screen options={{ title: state.community.name }} />
      <Title>{t("adminTitle")}</Title>
      <Body muted>{t("adminIntro")}</Body>
      <Segmented<AdminSection>
        value={section}
        onChange={setSection}
        options={[
          { value: "intake", label: t("adminSectionIntake"), badge: pendingRequests },
          { value: "people", label: t("adminSectionPeople") },
          { value: "reports", label: t("adminSectionReports"), badge: reports },
          ...(admin ? [{ value: "community" as const, label: t("adminSectionCommunity") }] : []),
        ]}
      />
      {runner.error ? <Banner tone="danger" text={runner.error} /> : null}
      {runner.notice ? <Banner tone="ok" text={runner.notice} /> : null}
      <DisabledScope entry={entry}>
        {section === "intake" ? <IntakeSection entry={entry} requests={requests} reload={reload} runner={runner} /> : null}
        {section === "people" ? <PeopleSection entry={entry} runner={runner} /> : null}
        {section === "reports" ? <ReportsSection entry={entry} runner={runner} /> : null}
        {section === "community" && admin ? <CommunitySection entry={entry} /> : null}
      </DisabledScope>
    </Screen>
  );
}
