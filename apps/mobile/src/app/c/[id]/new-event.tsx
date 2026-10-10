import { toHex } from "@vamo-virar/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import * as ExpoCrypto from "expo-crypto";
import { useApp, useCommunity } from "../../../lib/context";
import { searchPlaces, type Place } from "../../../model/places";
import { deviceTimeZone, formatDateInput, parseDurationHours, parseLocal } from "../../../model/time";
import { DisabledScope } from "../../../ui/community/Disabled";
import { Banner, Body, Button, Card, Field, Screen } from "../../../ui/kit";
import { space } from "../../../ui/theme";

export default function NewEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, store } = useApp();
  const entry = useCommunity(id);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(formatDateInput(Date.now() + 86_400_000));
  const [time, setTime] = useState("18:00");
  const [hours, setHours] = useState("3");
  const [placeName, setPlaceName] = useState("");
  const [areaQuery, setAreaQuery] = useState("");
  const [area, setArea] = useState<Place | null>(null);
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => (area ? [] : searchPlaces(areaQuery)), [areaQuery, area]);

  function save() {
    const start = parseLocal(date, time);
    const dur = parseDurationHours(hours);
    if (!title.trim()) return setError(t("invalidTitle"));
    if (start === null || dur === null) return setError(t("invalidDate"));
    if (!area) return setError(t("placeArea"));
    const cap = capacity.trim() ? Number(capacity) : undefined;
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) return setError(t("capacity"));
    store.submit(id!, "event.create", {
      event_id: toHex(ExpoCrypto.getRandomBytes(16)),
      title: title.trim(),
      description: description.trim(),
      starts_at: start,
      ends_at: start + dur,
      tz: deviceTimeZone(),
      location: { label: placeName.trim() || area.name, area: { lat_e4: area.lat_e4, lng_e4: area.lng_e4 } },
      ...(cap !== undefined ? { capacity: cap } : {}),
    });
    router.back();
  }

  return (
    <Screen>
      {entry ? (
        <DisabledScope entry={entry}>
          <Field testID="event-title" label={t("eventTitle")} value={title} onChangeText={setTitle} />
          <Field label={t("eventDescription")} value={description} onChangeText={setDescription} multiline />
          <View style={{ flexDirection: "row", gap: space.s }}>
            <View style={{ flex: 1 }}>
              <Button kind="secondary" label={t("today")} onPress={() => setDate(formatDateInput(Date.now()))} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="secondary" label={t("tomorrow")} onPress={() => setDate(formatDateInput(Date.now() + 86_400_000))} />
            </View>
          </View>
          <Field testID="event-date" label={t("date")} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
          <Field testID="event-time" label={t("startTime")} value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" />
          <Field label={t("durationHours")} value={hours} onChangeText={setHours} keyboardType="decimal-pad" />
          <Field testID="event-place" label={t("placeName")} value={placeName} onChangeText={setPlaceName} />
          <Field
            testID="event-area"
            label={t("placeArea")}
            value={area ? area.name : areaQuery}
            onChangeText={(s) => {
              setArea(null);
              setAreaQuery(s);
            }}
          />
          {matches.map((p) => (
            <Card key={p.name} testID={`area-${p.name}`} onPress={() => setArea(p)}>
              <Body>{p.name}</Body>
            </Card>
          ))}
          <Field label={t("capacity")} value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
          {error ? <Banner tone="danger" text={error} /> : null}
          <Button testID="event-save" label={t("save")} onPress={save} />
        </DisabledScope>
      ) : null}
    </Screen>
  );
}
