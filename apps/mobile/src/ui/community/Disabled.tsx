import type { ReactNode } from "react";
import { useApp } from "../../lib/context";
import type { CommunityEntry } from "../../lib/store";
import { Banner, ReadOnly } from "../kit";

/**
 * A community an admin disabled (marked for deletion, protocol §11.5): a
 * banner for everyone, and nothing below it can change.
 */
export function DisabledScope({ entry, children }: { entry: CommunityEntry; children: ReactNode }) {
  const { t, locale } = useApp();
  const d = entry.replica.disabled;
  if (!d) return <>{children}</>;
  const state = entry.replica.view;
  const who = state ? Object.values(state.members).find((m) => m.msk === d.by)?.profile?.display_name : undefined;
  const date = new Date(d.deleteAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  const text = t("disabledBanner")
    .replace("{who}", who ?? t("disabledBySomeone"))
    .replace("{date}", date);
  return (
    <ReadOnly.Provider value>
      <Banner tone="danger" text={text} />
      {children}
    </ReadOnly.Provider>
  );
}
