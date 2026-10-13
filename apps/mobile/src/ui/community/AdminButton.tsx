// The header button into the administration, with what waits there. The
// tabs layout puts it on the right of the community's header; Storybook's
// frame draws it in the same place.

import { Pressable, Text } from "react-native";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { fill } from "../../model/i18n";
import { useJoinRequests } from "../admin/hooks";
import { CountBadge } from "../kit";
import { fonts, space, useTheme } from "../theme";

export function AdminButton({ pending, onPress }: { pending: number; onPress: () => void }) {
  const { t } = useApp();
  const c = useTheme();
  return (
    <Pressable
      testID="open-admin"
      accessibilityRole="button"
      accessibilityLabel={pending ? `${t("adminOpen")} (${pending})` : t("adminOpen")}
      accessibilityHint={pending ? (pending === 1 ? t("adminPendingOne") : fill(t("adminPendingMany"), { n: pending })) : undefined}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.s, minHeight: 40, opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ color: c.primary, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{t("adminOpen")}</Text>
      {pending ? <CountBadge n={pending} /> : null}
    </Pressable>
  );
}

/** How many things wait for this person in the administration: join requests and reports. Zero unless they moderate. */
export function useAdminPending(entry: CommunityEntry | undefined): { mod: boolean; pending: number } {
  const r = entry?.replica;
  const mod = !!r && r.status === "active" && !!r.view && r.canModerate;
  const { requests } = useJoinRequests(entry, mod);
  return { mod, pending: mod ? (requests?.length ?? 0) + r.reports.length : 0 };
}
