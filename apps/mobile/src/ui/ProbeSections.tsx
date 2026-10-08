import type { Event } from "@vamo-virar/domain";
import { probeAnswer } from "@vamo-virar/matching";
import type { ProbeAnswer } from "@vamo-virar/sync";
import { useState } from "react";
import { View } from "react-native";
import { useApp, useEligibility } from "../lib/context";
import type { CommunityEntry } from "../lib/store";
import { Banner, Body, Button, Card, Heading } from "./kit";
import { space } from "./theme";
import { errorText } from "../model/errors";

const ANSWER_KEY = { eligible: "probeCan", maybe: "probeMaybe", not_eligible: "probeCant" } as const;

/** Member side: the organizers asked whether I can come. */
export function ProbeQuestion({ entry, ev }: { entry: CommunityEntry; ev: Event }) {
  const { t, store } = useApp();
  const r = entry.replica;
  const probe = r.incomingProbes.find((p) => p.eventId === ev.event_id);
  const e = useEligibility({ starts_at: ev.starts_at, ends_at: ev.ends_at, area: ev.location.area });
  const [busy, setBusy] = useState(false);
  if (!probe) return null;
  const suggestion = e.known ? probeAnswer(e.verdict) : null;
  const answer = (a: ProbeAnswer) => {
    setBusy(true);
    void store.admin(entry.id, (rep) => rep.answerProbe(probe.probeId, a)).finally(() => setBusy(false));
  };
  return (
    <Card testID="probe-question">
      <Body>{t("probeQuestion")}</Body>
      {suggestion ? (
        <Body muted>
          {t("probeSuggestion")} {t(ANSWER_KEY[suggestion])}
        </Body>
      ) : null}
      <View style={{ gap: space.s }}>
        {(["eligible", "maybe", "not_eligible"] as ProbeAnswer[]).map((a) => (
          <Button key={a} testID={`probe-${a}`} kind={a === suggestion ? "primary" : "secondary"} busy={busy} label={t(ANSWER_KEY[a])} onPress={() => answer(a)} />
        ))}
        <Button kind="secondary" label={t("probeIgnore")} onPress={() => r.dropProbe(probe.probeId)} />
      </View>
      <Body muted>{t("probeOnlyAnswer")}</Body>
    </Card>
  );
}

/** Organizer side: ask and see answers. */
export function ProbeResults({ entry, ev }: { entry: CommunityEntry; ev: Event }) {
  const { t, store } = useApp();
  const r = entry.replica;
  const state = r.view!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = r.probeResults(ev.event_id);
  const names = (answer: ProbeAnswer) =>
    Object.entries(sent?.replies ?? {})
      .filter(([, a]) => a === answer)
      .map(([id]) => state.members[id]?.profile?.display_name ?? "?");
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
          {Object.keys(sent.replies).length === 0 ? <Body muted>{t("noAnswersYet")}</Body> : null}
          {(["eligible", "maybe", "not_eligible"] as ProbeAnswer[]).map((a) => {
            const list = names(a);
            return list.length ? (
              <Body key={a}>
                {t(a === "eligible" ? "answersCan" : a === "maybe" ? "answersMaybe" : "answersCant")}: {list.join(", ")}
              </Body>
            ) : null;
          })}
        </Card>
      ) : null}
    </>
  );
}
