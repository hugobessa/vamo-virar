import { router } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useApp } from "../lib/context";
import { insecureStorage } from "../lib/storage";
import { Text, View } from "react-native";
import { Display, Star, Wordmark } from "../ui/brand";
import { Banner, Body, Button, Card, Chip, Heading, Screen } from "../ui/kit";
import { fonts, space, useTheme } from "../ui/theme";

function Points({ items }: { items: string[] }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s, marginVertical: space.s }}>
      {items.map((text) => (
        <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
          <Star size={18} />
          <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 16, fontWeight: "600" }}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

export default function Home() {
  const { store, t } = useApp();
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
          <Wordmark size="lg" />
          <Display size="h1" tone="brand">{t("welcomeTitle")}</Display>
          <Body muted>{t("welcomeBody")}</Body>
          <Points items={[t("welcomePoint1"), t("welcomePoint2"), t("welcomePoint3")]} />
        </>
      ) : (
        <>
          <Heading>{t("yourCommunities")}</Heading>
          {communities.map((e) => {
            const status = e.replica.status;
            const name = e.replica.view?.community.name;
            return (
              <Card accent key={e.id} testID={`community-${e.id}`} onPress={() => router.push({ pathname: "/c/[id]", params: { id: e.id } })}>
                <Body>{name ?? t("waitingTitle")}</Body>
                {status === "joining" ? <Chip label={t("waitingTitle")} tone="warn" /> : null}
                {status === "rejected" ? <Chip label={t("rejectedTitle")} tone="danger" /> : null}
                {status === "removed" ? <Chip label={t("syncRemoved")} tone="danger" /> : null}
                {e.replica.disabled ? <Chip label={t("disabledChip")} tone="danger" /> : null}
              </Card>
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
