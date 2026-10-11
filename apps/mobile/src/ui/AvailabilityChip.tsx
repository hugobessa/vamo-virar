import { View } from "react-native";
import { useApp, useEligibility } from "../lib/context";
import { Chip, type ChipTone } from "./kit";
import { space } from "./theme";

const WORST: ChipTone[] = ["ok", "warn", "danger"];
const worse = (a: ChipTone, b: ChipTone): ChipTone => (WORST.indexOf(a) >= WORST.indexOf(b) ? a : b);

/**
 * Shows, only to this person, whether their calendar and places fit an event.
 * `compact` folds both verdicts into one chip for lists; the event screen
 * shows them separately.
 */
export function AvailabilityChip({ ev, compact }: { ev: { starts_at: number; ends_at: number; location: { area: { lat_e4: number; lng_e4: number } } }; compact?: boolean }) {
  const { t } = useApp();
  const e = useEligibility({ starts_at: ev.starts_at, ends_at: ev.ends_at, area: ev.location.area });
  const parts: { label: string; tone: ChipTone }[] = [];
  const cal = e.calendar?.verdict;
  if (cal) {
    const tone: ChipTone = cal === "available" ? "ok" : cal === "maybe" ? "warn" : "danger";
    const key = compact
      ? cal === "available"
        ? "availFreeShort"
        : cal === "maybe"
          ? "availMaybeShort"
          : "availBusyShort"
      : cal === "available"
        ? "availFree"
        : cal === "maybe"
          ? "availMaybe"
          : "availBusy";
    parts.push({ label: t(key), tone });
  }
  const loc = e.location;
  if (loc.verdict !== "unknown" && loc.point) {
    const km = loc.distanceKm !== undefined ? ` · ${loc.distanceKm < 10 ? loc.distanceKm.toFixed(1) : Math.round(loc.distanceKm)} km` : "";
    const label =
      loc.verdict === "near" ? `${t("nearOf")} ${loc.point.label}${km}` : loc.verdict === "edge" ? `${t("edgeOf")} ${loc.point.label}${km}` : `${t("farFromYou")}${km}`;
    parts.push({ label, tone: loc.verdict === "near" ? "ok" : loc.verdict === "edge" ? "warn" : "danger" });
  }
  if (!parts.length) return null;
  if (compact) {
    const tone = parts.map((p) => p.tone).reduce(worse);
    return <Chip label={parts.map((p) => p.label).join(" · ")} tone={tone} />;
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
      {parts.map((p) => (
        <Chip key={p.label} label={p.label} tone={p.tone} />
      ))}
    </View>
  );
}
