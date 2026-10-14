import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useApp } from "../lib/context";
import { searchPhoton } from "../lib/geocode";
import type { PickedPlace, PlaceSuggestion } from "../model/location";
import { searchPlaces } from "../model/places";
import { Banner, Body, Button, Card, Field } from "./kit";
import { fonts, space, useTheme } from "./theme";

const DEBOUNCE_MS = 350;
const MIN_CHARS = 3;

/**
 * Where an event happens. The "Local" field autocompletes as the organizer
 * types: the built-in city list answers at once (and offline), and Photon
 * (OpenStreetMap) adds places and addresses. Picking a row fills the name and
 * the coordinates; the name stays editable ("Praça do Derby, portão norte")
 * until "Trocar lugar" starts a new search.
 *
 * `name` is what people will read; `place` carries the coordinates.
 */
export function LocationPicker({
  name,
  onNameChange,
  place,
  onPlaceChange,
  testID = "event",
}: {
  name: string;
  onNameChange: (name: string) => void;
  place: PickedPlace | null;
  onPlaceChange: (place: PickedPlace | null) => void;
  testID?: string;
}) {
  const { t } = useApp();
  const c = useTheme();
  const [remote, setRemote] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "empty" | "error">("idle");
  const latest = useRef("");

  const query = place ? "" : name.trim();
  const cities = useMemo(() => (query ? searchPlaces(query) : []), [query]);

  useEffect(() => {
    latest.current = query;
    if (query.length < MIN_CHARS) {
      setRemote([]);
      setStatus("idle");
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("searching");
      try {
        const rows = await searchPhoton(query, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setRemote(rows);
        setStatus(rows.length === 0 ? "empty" : "idle");
      } catch {
        if (ctrl.signal.aborted) return;
        setRemote([]);
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  function pick(p: PickedPlace) {
    setRemote([]);
    setStatus("idle");
    onNameChange(p.name);
    onPlaceChange(p);
  }

  return (
    <View style={{ gap: space.s }}>
      <Field testID={`${testID}-place`} label={t("placeName")} help={place ? undefined : t("placeSearchHelp")} value={name} onChangeText={onNameChange} autoCorrect={false} />
      {place ? (
        <Card testID={`${testID}-place-picked`}>
          <Body>{place.name}</Body>
          {place.address ? <Body muted>{place.address}</Body> : null}
          <Button testID={`${testID}-place-change`} kind="secondary" compact label={t("placeChange")} onPress={() => onPlaceChange(null)} />
        </Card>
      ) : (
        <>
          {cities.map((p) => (
            <Card key={p.name} testID={`area-${p.name}`} onPress={() => pick({ name: p.name, lat_e4: p.lat_e4, lng_e4: p.lng_e4 })}>
              <Body>{p.name}</Body>
            </Card>
          ))}
          {remote.map((s, i) => (
            <Card key={s.id} testID={`${testID}-place-suggestion-${i}`} onPress={() => pick(s)}>
              <Body>{s.name}</Body>
              {s.address ? <Body muted>{s.address}</Body> : null}
            </Card>
          ))}
          {status === "searching" ? <Body muted>{t("placeSearching")}</Body> : null}
          {status === "empty" && cities.length === 0 ? <Body muted>{t("placeNoResults")}</Body> : null}
          {status === "error" ? <Banner tone="warn" text={t("placeSearchError")} /> : null}
          {remote.length > 0 ? <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 12, textAlign: "right" }}>{t("placeSuggestionsBy")}</Text> : null}
        </>
      )}
    </View>
  );
}
