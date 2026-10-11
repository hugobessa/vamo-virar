import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Text, View } from "react-native";
import { useApp, useNow } from "../lib/context";
import { insecureStorage } from "../lib/storage";
import { upcoming } from "../model/events";
import { fill } from "../model/i18n";
import { dateBlock, formatHours } from "../model/time";
import { Display, Star, Wordmark } from "../ui/brand";
import { Banner, Body, Button, Card, Chip, Enter, Heading, Screen } from "../ui/kit";
import { fonts, motion, space, useReducedMotion, useTheme } from "../ui/theme";

function Points({ items }: { items: string[] }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s, marginVertical: space.s }}>
      {items.map((text, i) => (
        <Enter key={text} delay={motion.slow + i * motion.stagger * 2} from={12}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
            <Star size={18} />
            <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 16, fontWeight: "600" }}>{text}</Text>
          </View>
        </Enter>
      ))}
    </View>
  );
}

/** The wordmark lands from the splash screen: it settles into place as the star turns once. */
function Landing() {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduced ? 0 : motion.story, easing: motion.easing.overshoot, useNativeDriver: true }).start();
  }, [v, reduced]);
  return (
    <Animated.View
      style={{
        opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.15, 1] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-4deg", "0deg"] }) }],
      }}
    >
      <Wordmark size="lg" />
    </Animated.View>
  );
}

export default function Home() {
  const { store, t, locale } = useApp();
  const now = useNow();
  if (!store.ready) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }
  const communities = store.list();
  return (
    <Screen>
      {insecureStorage ? <Banner tone="warn" text={t("webPreviewWarning")} /> : null}
      {communities.length === 0 ? (
        <>
          <Landing />
          <Enter delay={motion.base}>
            <Display size="h1" tone="brand">{t("welcomeTitle")}</Display>
          </Enter>
          <Enter delay={motion.base + motion.stagger * 2}>
            <Body muted>{t("welcomeBody")}</Body>
          </Enter>
          <Points items={[t("welcomePoint1"), t("welcomePoint2"), t("welcomePoint3")]} />
        </>
      ) : (
        <>
          <Heading>{t("yourCommunities")}</Heading>
          {communities.map((e, i) => {
            const status = e.replica.status;
            const view = e.replica.view;
            const name = view?.community.name;
            const next = view ? upcoming(view, now)[0] : undefined;
            const when = next ? dateBlock(next.starts_at, now, locale, next.tz, { today: t("today"), tomorrow: t("tomorrow") }) : null;
            // Things waiting for this person: questions from the organizers and open invitations.
            const toAnswer =
              e.replica.incomingProbes.length + (view ? Object.values(view.events).filter((ev) => ev.status === "scheduled" && ev.participations[e.replica.memberId]?.status === "invited").length : 0);
            return (
              <Enter key={e.id} delay={i * motion.stagger}>
                <Card accent testID={`community-${e.id}`} onPress={() => router.push({ pathname: "/c/[id]", params: { id: e.id } })}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.s }}>
                    <Heading>{name ?? t("waitingTitle")}</Heading>
                    {toAnswer > 0 ? <Chip label={`${toAnswer} ${t("homeToAnswer")}`} tone="warn" /> : null}
                  </View>
                  {status === "active" && view ? (
                    <Body muted>{next && when ? `${t("homeNext")}: ${next.title} · ${when.heading}, ${formatHours(next.starts_at, next.ends_at, locale, next.tz).split(" – ")[0]}` : t("homeNoNext")}</Body>
                  ) : null}
                  {status === "joining" ? <Chip label={t("waitingTitle")} tone="warn" /> : null}
                  {status === "rejected" ? <Chip label={t("rejectedTitle")} tone="danger" /> : null}
                  {status === "removed" ? <Chip label={t("syncRemoved")} tone="danger" /> : null}
                  {e.replica.disabled ? <Chip label={t("disabledChip")} tone="danger" /> : null}
                </Card>
              </Enter>
            );
          })}
        </>
      )}
      <Button testID="go-create" label={t("createCommunity")} onPress={() => router.push("/create")} />
      <Button testID="go-join" kind="secondary" label={t("joinCommunity")} onPress={() => router.push("/join")} />
      <Button testID="go-settings" kind="secondary" label={t("calendarsTitle")} onPress={() => router.push("/settings")} />
    </Screen>
  );
}
