import { toHex } from "@vamo-virar/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as ExpoCrypto from "expo-crypto";
import { useApp, useCommunity } from "../../../lib/context";
import type { StringKey } from "../../../model/i18n";
import { searchPlaces, type Place } from "../../../model/places";
import { deviceTimeZone, formatDateInput, parseDurationHours, parseLocal } from "../../../model/time";
import { DateTimeFields } from "../../../ui/DateTimeFields";
import { DisabledScope } from "../../../ui/community/Disabled";
import { Banner, Body, Button, Card, Field, Screen } from "../../../ui/kit";
import { fonts, radius, space, touch, useTheme } from "../../../ui/theme";
import { parseWhatsApp, WhatsAppField } from "../../../ui/WhatsApp";

/** Common campaign actions: picking one fills the title and a typical duration and start. */
const TEMPLATES: { key: StringKey; hours: string; time: string }[] = [
  { key: "tplPanfletagem", hours: "2", time: "08:00" },
  { key: "tplBandeiraco", hours: "1,5", time: "17:00" },
  { key: "tplCaminhada", hours: "3", time: "09:00" },
  { key: "tplAdesivaco", hours: "2", time: "10:00" },
  { key: "tplPlenaria", hours: "2", time: "19:00" },
  { key: "tplCorpoACorpo", hours: "2", time: "16:00" },
];

export default function NewEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, store } = useApp();
  const c = useTheme();
  const entry = useCommunity(id);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<StringKey | null>(null);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(formatDateInput(Date.now() + 86_400_000));
  const [time, setTime] = useState("18:00");
  const [hours, setHours] = useState("3");
  const [placeName, setPlaceName] = useState("");
  const [areaQuery, setAreaQuery] = useState("");
  const [area, setArea] = useState<Place | null>(null);
  const [capacity, setCapacity] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => (area ? [] : searchPlaces(areaQuery)), [areaQuery, area]);

  function pickTemplate(tpl: (typeof TEMPLATES)[number]) {
    setTemplate(tpl.key);
    // Only fill what the person has not typed yet.
    if (!title.trim() || TEMPLATES.some((x) => t(x.key) === title.trim())) setTitle(t(tpl.key));
    setHours(tpl.hours);
    setTime(tpl.time);
  }

  function save() {
    const start = parseLocal(date, time);
    const dur = parseDurationHours(hours);
    if (!title.trim()) return setError(t("invalidTitle"));
    if (start === null || dur === null) return setError(t("invalidDate"));
    if (!area) return setError(t("placeArea"));
    const cap = capacity.trim() ? Number(capacity) : undefined;
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) return setError(t("capacity"));
    const wa = parseWhatsApp(whatsapp);
    if (wa.invalid) return setError(t("whatsappInvalid"));
    store.submit(id!, "event.create", {
      event_id: toHex(ExpoCrypto.getRandomBytes(16)),
      title: title.trim(),
      description: description.trim(),
      starts_at: start,
      ends_at: start + dur,
      tz: deviceTimeZone(),
      location: { label: placeName.trim() || area.name, area: { lat_e4: area.lat_e4, lng_e4: area.lng_e4 } },
      ...(cap !== undefined ? { capacity: cap } : {}),
      ...(wa.link ? { whatsapp: wa.link } : {}),
    });
    router.back();
  }

  return (
    <Screen>
      {entry ? (
        <DisabledScope entry={entry}>
          <View style={{ gap: space.xs }}>
            <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{t("templatesLabel")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingVertical: 2 }}>
              {TEMPLATES.map((tpl) => {
                const on = template === tpl.key;
                return (
                  <Pressable
                    key={tpl.key}
                    testID={`template-${tpl.key}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => pickTemplate(tpl)}
                    style={({ pressed }) => ({
                      minHeight: touch - 8,
                      paddingHorizontal: space.l,
                      justifyContent: "center",
                      borderRadius: radius,
                      borderWidth: 1,
                      borderColor: on ? c.primary : c.border,
                      backgroundColor: on ? c.primary : c.surface,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <Text style={{ color: on ? c.primaryText : c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "700" }}>{t(tpl.key)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
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
          <DateTimeFields
            date={date}
            time={time}
            onChange={(d, tm) => {
              setDate(d);
              setTime(tm);
            }}
          />
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
          <WhatsAppField testID="event-whatsapp" value={whatsapp} onChangeText={setWhatsapp} />
          {error ? <Banner tone="danger" text={error} /> : null}
          <Button testID="event-save" label={t("save")} haptic="confirm" onPress={save} />
        </DisabledScope>
      ) : null}
    </Screen>
  );
}
