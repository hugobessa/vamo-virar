import { useMemo, useState } from "react";
import { Switch, View } from "react-native";
import { deviceCalendarsSupported } from "../lib/matching";
import { useApp, useCalendarService } from "../lib/context";
import { searchPlaces, type Place } from "../model/places";
import { formatDateInput, parseLocal } from "../model/time";
import { Banner, Body, Button, Card, Field, Heading } from "./kit";
import { space } from "./theme";

export function PlacesSettings() {
  const { t } = useApp();
  const svc = useCalendarService();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<Place | null>(null);
  const [radius, setRadius] = useState("15");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = useMemo(() => (area ? [] : searchPlaces(query)), [query, area]);
  const radiusKm = Number(radius.replace(",", "."));

  async function save() {
    setError(null);
    const a = from.trim() ? parseLocal(from, "00:00") : undefined;
    const b = to.trim() ? parseLocal(to, "23:59") : undefined;
    if (!area || !label.trim() || !(radiusKm > 0) || a === null || b === null || (a !== undefined && b !== undefined && b < a)) {
      setError(t("invalidDate"));
      return;
    }
    await svc.addPlace({
      label: label.trim(),
      lat_e4: area.lat_e4,
      lng_e4: area.lng_e4,
      radiusKm,
      ...(a !== undefined ? { activeFrom: a } : {}),
      ...(b !== undefined ? { activeTo: b } : {}),
    });
    setAdding(false);
    setLabel("");
    setQuery("");
    setArea(null);
    setFrom("");
    setTo("");
  }

  return (
    <>
      <Heading>{t("placesTitle")}</Heading>
      <Body muted>{t("placesHelp")}</Body>
      {svc.places().map((p) => (
        <Card key={p.id} testID={`place-${p.label}`}>
          <Body>
            {p.label} · {p.radiusKm} km
          </Body>
          {p.activeFrom || p.activeTo ? (
            <Body muted>
              {p.activeFrom ? formatDateInput(p.activeFrom) : "…"} – {p.activeTo ? formatDateInput(p.activeTo) : "…"}
            </Body>
          ) : null}
          <Button kind="secondary" label={t("removePlace")} onPress={() => void svc.removePlace(p.id)} />
        </Card>
      ))}
      {deviceCalendarsSupported ? (
        <Button
          kind="secondary"
          label={t("useHereNow")}
          onPress={async () => setDenied(!(await svc.addCurrentLocation(t("hereLabel"), 15)))}
        />
      ) : null}
      {denied ? <Banner tone="warn" text={t("locationDenied")} /> : null}
      {adding ? (
        <Card>
          <Field testID="place-label" label={t("placeLabel")} value={label} onChangeText={setLabel} />
          <Field
            testID="place-area"
            label={t("placeArea")}
            value={area ? area.name : query}
            onChangeText={(s) => {
              setArea(null);
              setQuery(s);
            }}
          />
          {matches.map((p) => (
            <Card key={p.name} testID={`place-option-${p.name}`} onPress={() => setArea(p)}>
              <Body>{p.name}</Body>
            </Card>
          ))}
          <Field testID="place-radius" label={t("radiusKm")} value={radius} onChangeText={setRadius} keyboardType="decimal-pad" />
          <Field label={t("tripFrom")} value={from} onChangeText={setFrom} keyboardType="numbers-and-punctuation" />
          <Field label={t("tripTo")} value={to} onChangeText={setTo} keyboardType="numbers-and-punctuation" />
          {error ? <Banner tone="danger" text={error} /> : null}
          <Button testID="place-save" label={t("save")} onPress={save} />
        </Card>
      ) : (
        <Button testID="add-place" kind="secondary" label={t("addPlace")} onPress={() => setAdding(true)} />
      )}
      <Field
        label={t("travelSpeed")}
        value={String(svc.locationPrefs().travelKmh)}
        keyboardType="number-pad"
        onChangeText={(v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 3 && n <= 200) void svc.setTravelSpeed(n);
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
        <Switch testID="auto-answer" accessibilityLabel={t("autoAnswerLabel")} value={svc.autoAnswer()} onValueChange={(v) => void svc.setAutoAnswer(v)} />
        <View style={{ flex: 1 }}>
          <Body>{t("autoAnswerLabel")}</Body>
        </View>
      </View>
    </>
  );
}
