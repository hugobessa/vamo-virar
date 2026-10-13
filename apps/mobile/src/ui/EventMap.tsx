import { Linking, Text, View } from "react-native";
import { useApp } from "../lib/context";
import { mapsSearchUrl, snapArea, type Area } from "../model/location";
import { Button } from "./kit";
import { fonts, space, useTheme } from "./theme";

/**
 * Where an event happens, as a button that opens the point in the maps app.
 * `approximate` uses the centre of the ~1 km cell around the point instead
 * of the point itself (protocol.md §9.6), for people who have not confirmed.
 */
export function EventMap({ area, approximate = false, radiusM, testID }: { area: Area; approximate?: boolean; radiusM?: number; testID?: string }) {
  const { t } = useApp();
  const c = useTheme();
  const point = approximate ? snapArea(area, radiusM) : area;
  return (
    <View style={{ gap: space.s }} testID={testID}>
      {approximate ? <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 13 }}>{t("mapApproximate")}</Text> : null}
      <Button kind="secondary" compact allowReadOnly label={t("openInMaps")} onPress={() => void Linking.openURL(mapsSearchUrl(point))} />
    </View>
  );
}
