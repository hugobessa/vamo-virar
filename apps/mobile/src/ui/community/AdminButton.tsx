// The header button into the administration, with what waits there. The
// tabs layout puts it on the right of the community's header; Storybook's
// frame draws it in the same place.

import { ShieldCheck } from "lucide-react-native";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { fill } from "../../model/i18n";
import { useJoinRequests } from "../admin/hooks";
import { HeaderIconButton } from "../kit";

export function AdminButton({ pending, onPress }: { pending: number; onPress: () => void }) {
  const { t } = useApp();
  return (
    <HeaderIconButton
      testID="open-admin"
      icon={ShieldCheck}
      count={pending}
      label={t("adminOpen")}
      hint={pending ? (pending === 1 ? t("adminPendingOne") : fill(t("adminPendingMany"), { n: pending })) : undefined}
      onPress={onPress}
    />
  );
}

/** How many things wait for this person in the administration: join requests and reports. Zero unless they moderate. */
export function useAdminPending(entry: CommunityEntry | undefined): { mod: boolean; pending: number } {
  const r = entry?.replica;
  const mod = !!r && r.status === "active" && !!r.view && r.canModerate;
  const { requests } = useJoinRequests(entry, mod);
  return { mod, pending: mod ? (requests?.length ?? 0) + r.reports.length : 0 };
}
