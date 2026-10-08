import { useApp, useAvailability } from "../lib/context";
import { Chip } from "./kit";

/** Shows, only to this person, whether their calendar is free for a time. */
export function AvailabilityChip({ start, end }: { start: number; end: number }) {
  const { t } = useApp();
  const a = useAvailability({ start, end });
  if (!a) return null;
  if (a.verdict === "available") return <Chip label={t("availFree")} tone="ok" />;
  if (a.verdict === "maybe") return <Chip label={t("availMaybe")} tone="warn" />;
  return <Chip label={t("availBusy")} tone="danger" />;
}
