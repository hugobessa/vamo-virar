import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider, useApp } from "../lib/context";
import { useTheme } from "../ui/theme";

function Nav() {
  const { t } = useApp();
  const c = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        contentStyle: { backgroundColor: c.bg },
        headerBackTitle: t("back"),
      }}
    >
      <Stack.Screen name="index" options={{ title: t("appName") }} />
      <Stack.Screen name="create" options={{ title: t("createCommunity") }} />
      <Stack.Screen name="join" options={{ title: t("joinCommunity") }} />
      <Stack.Screen name="settings" options={{ title: `${t("calendarsTitle")} · ${t("placesTitle")}` }} />
      <Stack.Screen name="c/[id]/index" options={{ title: "" }} />
      <Stack.Screen name="c/[id]/new-event" options={{ title: t("newEvent"), presentation: "modal" }} />
      <Stack.Screen name="c/[id]/event/[eid]" options={{ title: "" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="auto" />
        <Nav />
      </AppProvider>
    </SafeAreaProvider>
  );
}
