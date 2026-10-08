import { router } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useApp } from "../lib/context";
import { insecureStorage } from "../lib/storage";
import { Banner, Body, Button, Card, Chip, Heading, Screen, Title } from "../ui/kit";

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
      {insecureStorage ? <Banner tone="warn" text="Web preview: data is stored unencrypted in this browser. Use the mobile app for real communities." /> : null}
      {communities.length === 0 ? (
        <>
          <Title>{t("welcomeTitle")}</Title>
          <Body muted>{t("welcomeBody")}</Body>
        </>
      ) : (
        <>
          <Heading>{t("yourCommunities")}</Heading>
          {communities.map((e) => {
            const status = e.replica.status;
            const name = e.replica.view?.community.name;
            return (
              <Card key={e.id} testID={`community-${e.id}`} onPress={() => router.push({ pathname: "/c/[id]", params: { id: e.id } })}>
                <Body>{name ?? t("waitingTitle")}</Body>
                {status === "joining" ? <Chip label={t("waitingTitle")} tone="warn" /> : null}
                {status === "rejected" ? <Chip label={t("rejectedTitle")} tone="danger" /> : null}
                {status === "removed" ? <Chip label={t("syncRemoved")} tone="danger" /> : null}
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
