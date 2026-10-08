import { useApp, useEligibility } from "../lib/context";
import { Chip } from "./kit";
import { View } from "react-native";
import { space } from "./theme";

/** Shows, only to this person, whether their calendar and places fit an event. */
export function AvailabilityChip({ ev }: { ev: { starts_at: number; ends_at: number; location: { area: { lat_e4: number; lng_e4: number } } } }) {
  const { t } = useApp();
  const e = useEligibility({ starts_at: ev.starts_at, ends_at: ev.ends_at, area: ev.location.area });
  const chips = [];
  if (e.calendar) {
    const v = e.calendar.verdict;
    chips.push(<Chip key="cal" label={t(v === "available" ? "availFree" : v === "maybe" ? "availMaybe" : "availBusy")} tone={v === "available" ? "ok" : v === "maybe" ? "warn" : "danger"} />);
  }
  const loc = e.location;
  if (loc.verdict !== "unknown" && loc.point) {
    const km = loc.distanceKm !== undefined ? ` · ${loc.distanceKm < 10 ? loc.distanceKm.toFixed(1) : Math.round(loc.distanceKm)} km` : "";
    const label =
      loc.verdict === "near" ? `${t("nearOf")} ${loc.point.label}${km}` : loc.verdict === "edge" ? `${t("edgeOf")} ${loc.point.label}${km}` : `${t("farFromYou")}${km}`;
    chips.push(<Chip key="loc" label={label} tone={loc.verdict === "near" ? "ok" : loc.verdict === "edge" ? "warn" : "danger"} />);
  }
  if (!chips.length) return null;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>{chips}</View>;
}
