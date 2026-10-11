import type { Event } from "@vamo-virar/domain";
import { probeAnswer } from "@vamo-virar/matching";
import type { ProbeAnswer } from "@vamo-virar/sync";
import { useEffect, useRef, useState } from "react";
import { Animated, LayoutAnimation, Text, View } from "react-native";
import { useApp, useEligibility } from "../lib/context";
import type { CommunityEntry } from "../lib/store";
import { Banner, Body, Button, Card, Heading, useToast } from "./kit";
import { fonts, motion, space, useReducedMotion, useTheme } from "./theme";
import { errorText } from "../model/errors";

const ANSWER_KEY = { eligible: "probeCan", maybe: "probeMaybe", not_eligible: "probeCant" } as const;

/**
 * Member side: the organizers asked whether I can come. The suggested answer
 * is already the primary button; answering collapses the card and leaves a
 * short confirmation that only the verdict left the phone.
 */
export function ProbeQuestion({ entry, ev }: { entry: CommunityEntry; ev: Event }) {
  const { t, store } = useApp();
  const reduced = useReducedMotion();
  const r = entry.replica;
  const probe = r.incomingProbes.find((p) => p.eventId === ev.event_id);
  const e = useEligibility({ starts_at: ev.starts_at, ends_at: ev.ends_at, area: ev.location.area });
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  if (!probe) return toast ? <>{toast}</> : null;
  const suggestion = e.known ? probeAnswer(e.verdict) : null;
  const answer = (a: ProbeAnswer) => {
    setBusy(true);
    void store
      .admin(entry.id, (rep) => rep.answerProbe(probe.probeId, a))
      .then(() => {
        if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        showToast(t("probeSent"));
      })
      .finally(() => setBusy(false));
  };
  return (
    <>
      <Card testID="probe-question">
        <Body>{t("probeQuestion")}</Body>
        {suggestion ? (
          <Body muted>
            {t("probeSuggestion")} {t(ANSWER_KEY[suggestion])}
          </Body>
        ) : null}
        <View style={{ gap: space.s }}>
          {(["eligible", "maybe", "not_eligible"] as ProbeAnswer[]).map((a) => (
            <Button key={a} testID={`probe-${a}`} kind={a === suggestion ? "primary" : "secondary"} busy={busy} haptic="confirm" label={t(ANSWER_KEY[a])} onPress={() => answer(a)} />
          ))}
          <Button kind="secondary" label={t("probeIgnore")} onPress={() => r.dropProbe(probe.probeId)} />
        </View>
        <Body muted>{t("probeOnlyAnswer")}</Body>
      </Card>
      {toast}
    </>
  );
}

/** One segment of the answers bar, growing to its share when it appears. */
function Segment({ share, color, delay }: { share: number; color: string; delay: number }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduced ? 0 : motion.story, delay: reduced ? 0 : delay, easing: motion.easing.out, useNativeDriver: false }).start();
  }, [v, delay, reduced]);
  if (share <= 0) return null;
  return <Animated.View style={{ flexGrow: v.interpolate({ inputRange: [0, 1], outputRange: [0.0001, share] }), flexBasis: 0, backgroundColor: color }} />;
}

/** Organizer side: ask and see answers as a stacked bar with the names under each colour. */
export function ProbeResults({ entry, ev }: { entry: CommunityEntry; ev: Event }) {
  const { t, store } = useApp();
  const c = useTheme();
  const r = entry.replica;
  const state = r.view!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = r.probeResults(ev.event_id);
  const names = (answer: ProbeAnswer) =>
    Object.entries(sent?.replies ?? {})
      .filter(([, a]) => a === answer)
      .map(([id]) => state.members[id]?.profile?.display_name ?? "?");
  const groups: { answer: ProbeAnswer; label: string; color: string; textColor: string }[] = [
    { answer: "eligible", label: t("answersCan"), color: c.green, textColor: c.ok },
    { answer: "maybe", label: t("answersMaybe"), color: c.accent, textColor: c.warn },
    { answer: "not_eligible", label: t("answersCant"), color: c.brand, textColor: c.danger },
  ];
  const replied = Object.keys(sent?.replies ?? {}).length;
  const silent = Math.max(0, (sent?.asked ?? 0) - replied);
  return (
    <>
      <Button
        testID="ask-who-can-come"
        kind="secondary"
        busy={busy}
        label={t("askWhoCanCome")}
        onPress={() => {
          setBusy(true);
          setError(null);
          void store
            .admin(entry.id, (rep) => rep.askWhoCanCome(ev.event_id))
            .catch((e: unknown) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
      />
      {error ? <Banner tone="danger" text={`${t("error")}: ${error}`} /> : null}
      {sent ? (
        <Card testID="probe-results">
          <Heading>
            {t("askedPeople")}: {sent.asked}
          </Heading>
          {replied === 0 ? (
            <Body muted>{t("noAnswersYet")}</Body>
          ) : (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", backgroundColor: c.chip }}>
              {groups.map((g, i) => (
                <Segment key={g.answer} share={names(g.answer).length} color={g.color} delay={i * motion.stagger * 2} />
              ))}
              {silent > 0 ? <View style={{ flexGrow: silent, flexBasis: 0 }} /> : null}
            </View>
          )}
          {groups.map((g) => {
            const people = names(g.answer);
            return (
              <View key={g.answer} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.s }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: g.color, marginTop: 7 }} />
                <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 16, lineHeight: 24 }}>
                  <Text style={{ color: g.textColor, fontWeight: "700" }}>{g.label}</Text>
                  {people.length ? `: ${people.join(", ")}` : ` (0)`}
                </Text>
              </View>
            );
          })}
        </Card>
      ) : null}
    </>
  );
}
