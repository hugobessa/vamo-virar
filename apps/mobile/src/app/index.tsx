import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Text, View } from "react-native";
import { useApp, useNow } from "../lib/context";
import { insecureStorage } from "../lib/storage";
import { taskNewsCount, toAnswerCount } from "../model/attention";
import { upcoming } from "../model/events";
import { fill } from "../model/i18n";
import { dateBlock, formatHours } from "../model/time";
import { Display, Star, Wordmark } from "../ui/brand";
import { Actions, Banner, Body, Button, Card, Chip, Enter, Grid, Heading, Screen } from "../ui/kit";
import { useLayout } from "../ui/layout";
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
  const l = useLayout();
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
      <Wordmark size={l.wide ? "xl" : "lg"} />
    </Animated.View>
  );
}

/** First visit: the wordmark and the pitch, side by side where there is room. */
function Welcome() {
  const { t } = useApp();
  const l = useLayout();
  const text = (
    <View style={{ flex: l.wide ? 1 : undefined, maxWidth: 560, gap: space.m }}>
      <Enter delay={motion.base}>
        <Display size="h1" tone="brand">{t("welcomeTitle")}</Display>
      </Enter>
      <Enter delay={motion.base + motion.stagger * 2}>
        <Body muted>{t("welcomeBody")}</Body>
      </Enter>
      <Points items={[t("welcomePoint1"), t("welcomePoint2"), t("welcomePoint3")]} />
    </View>
  );
  return l.wide ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.huge, paddingVertical: space.xl }}>
      <Landing />
      {text}
    </View>
  ) : (
    <>
      <Landing />
      {text}
    </>
  );
}

export default function Home() {
  const { store, t, locale } = useApp();
  const now = useNow();
  const l = useLayout();
  if (!store.ready) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }
  const communities = store.list();
  return (
    <Screen width="board">
      {insecureStorage ? <Banner tone="warn" text={t("webPreviewWarning")} /> : null}
      {communities.length === 0 ? (
        <Welcome />
      ) : (
        <>
          <Heading>{t("yourCommunities")}</Heading>
          <Grid columns={l.listColumns}>
            {communities.map((e, i) => {
              const status = e.replica.status;
              const view = e.replica.view;
              const name = view?.community.name;
              const next = view ? upcoming(view, now)[0] : undefined;
              const when = next ? dateBlock(next.starts_at, now, locale, next.tz, { today: t("today"), tomorrow: t("tomorrow") }) : null;
              // Things waiting for this person: questions from the organizers and open invitations.
              const toAnswer = toAnswerCount(view, e.replica.memberId, e.replica.incomingProbes.length);
              const taskNews = taskNewsCount(view, e.replica.memberId, e.replica.taskMarks, status === "active");
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
                    {taskNews > 0 ? <Chip label={taskNews === 1 ? t("homeTaskNewsOne") : fill(t("homeTaskNewsMany"), { n: taskNews })} tone="warn" /> : null}
                    {status === "joining" ? <Chip label={t("waitingTitle")} tone="warn" /> : null}
                    {status === "rejected" ? <Chip label={t("rejectedTitle")} tone="danger" /> : null}
                    {status === "removed" ? <Chip label={t("syncRemoved")} tone="danger" /> : null}
                    {e.replica.disabled ? <Chip label={t("disabledChip")} tone="danger" /> : null}
                  </Card>
                </Enter>
              );
            })}
          </Grid>
        </>
      )}
      <Actions>
        <Button testID="go-create" label={t("createCommunity")} onPress={() => router.push("/create")} />
        <Button testID="go-join" kind="secondary" label={t("joinCommunity")} onPress={() => router.push("/join")} />
        {/* With the sidebar on screen these two are already there. */}
        {l.sidebar ? null : <Button testID="go-settings" kind="secondary" label={t("calendarsTitle")} onPress={() => router.push("/settings")} />}
        {l.sidebar ? null : <Button testID="go-safety" kind="secondary" label={t("safetyTitle")} onPress={() => router.push("/safety")} />}
      </Actions>
    </Screen>
  );
}
