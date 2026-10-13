import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider, useApp } from "../lib/context";
import { SidebarShown, useLayout, useSidebarFits } from "../ui/layout";
import { Sidebar } from "../ui/Sidebar";
import { fonts, useTheme } from "../ui/theme";

function Nav() {
  const { t } = useApp();
  const c = useTheme();
  const l = useLayout();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.display, fontWeight: "900" },
        // The content sits in a centred column on a wider window; the title goes with it.
        ...(Platform.OS === "web" && !l.compact ? { headerTitleAlign: "center" as const } : {}),
        contentStyle: { backgroundColor: c.bg },
        headerBackTitle: t("back"),
      }}
    >
      <Stack.Screen name="index" options={{ title: t("appName") }} />
      <Stack.Screen name="create" options={{ title: t("createCommunity") }} />
      <Stack.Screen name="join" options={{ title: t("joinCommunity") }} />
      <Stack.Screen name="settings" options={{ title: `${t("calendarsTitle")} · ${t("placesTitle")}` }} />
      <Stack.Screen name="safety" options={{ title: t("safetyTitle") }} />
      <Stack.Screen name="devices" options={{ title: t("devicesTitle") }} />
      <Stack.Screen name="link-offer" options={{ title: t("linkAnother") }} />
      <Stack.Screen name="link" options={{ title: t("linkHaveOther") }} />
      <Stack.Screen name="c/[id]/index" options={{ title: "" }} />
      <Stack.Screen name="c/[id]/new-event" options={{ title: t("newEvent"), presentation: "modal" }} />
      <Stack.Screen name="c/[id]/event/[eid]" options={{ title: "" }} />
      <Stack.Screen name="c/[id]/task-form" options={{ title: t("newTask"), presentation: "modal" }} />
      <Stack.Screen name="c/[id]/task/[tid]" options={{ title: "" }} />
    </Stack>
  );
}

/** On a wide web window the communities sit in a sidebar beside the screens. */
function Shell() {
  const c = useTheme();
  const sidebar = useSidebarFits();
  return (
    <SidebarShown.Provider value={sidebar}>
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: c.bg }}>
        {sidebar ? <Sidebar /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Nav />
        </View>
      </View>
    </SidebarShown.Provider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="auto" />
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
