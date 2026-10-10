import { createContext, useContext, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { fonts, space, useTheme } from "../ui/theme";
import { ScenarioProvider, type Scenario } from "./scenario";

const HeaderTitle = createContext<(title: string) => void>(() => {});

/**
 * "phone" draws the rounded device frame; "bare" fills the viewport with a
 * status bar on top, for store screenshots (see scripts/store-screenshots.mjs).
 */
export const PhoneFrame = createContext<"phone" | "bare">("phone");

/** Lets `<Stack.Screen options={{ title }}>` set the title of the frame's header. */
export function useHeaderTitle() {
  return useContext(HeaderTitle);
}

/**
 * Phone-sized frame with a header like the app's stack header, around a real
 * screen. `title` is the header text until the screen sets its own.
 */
export function Phone({ title, scenario, children }: { title: string; scenario: Partial<Scenario>; children: ReactNode }) {
  const c = useTheme();
  const [override, setOverride] = useState<string | null>(null);
  const frame = useContext(PhoneFrame);
  const header = (
    <View style={{ height: 52, justifyContent: "center", paddingHorizontal: space.l, backgroundColor: c.bg }}>
      <Text numberOfLines={1} style={{ color: c.text, fontFamily: fonts.display, fontSize: 17, fontWeight: "900" }}>
        {override ?? title}
      </Text>
    </View>
  );
  if (frame === "bare") {
    return (
      <ScenarioProvider scenario={scenario}>
        <SafeAreaProvider>
          <HeaderTitle.Provider value={setOverride}>
            <View style={{ width: "100vw" as unknown as number, height: "100vh" as unknown as number, overflow: "hidden", backgroundColor: c.bg }}>
              <StatusBar />
              {header}
              <View style={{ flex: 1 }}>{children}</View>
            </View>
          </HeaderTitle.Provider>
        </SafeAreaProvider>
      </ScenarioProvider>
    );
  }
  return (
    <ScenarioProvider scenario={scenario}>
      <SafeAreaProvider>
        <HeaderTitle.Provider value={setOverride}>
          <View style={{ padding: space.xl, alignItems: "center" }}>
            <View style={{ width: 390, maxWidth: "100%", height: 780, borderRadius: 36, borderWidth: 8, borderColor: c.frame, overflow: "hidden", backgroundColor: c.bg }}>
              {header}
              <View style={{ flex: 1 }}>{children}</View>
            </View>
          </View>
        </HeaderTitle.Provider>
      </SafeAreaProvider>
    </ScenarioProvider>
  );
}

/** Clock, signal and battery, drawn like a phone's status bar. */
function StatusBar() {
  const c = useTheme();
  return (
    <View style={{ height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.xl, backgroundColor: c.bg }}>
      <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "600" }}>15:00</Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
          {[4, 6, 8, 10].map((h) => (
            <View key={h} style={{ width: 3, height: h, borderRadius: 1, backgroundColor: c.text }} />
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
          <View style={{ width: 22, height: 11, borderRadius: 3, borderWidth: 1, borderColor: c.text, padding: 1 }}>
            <View style={{ width: "80%", height: "100%", borderRadius: 1, backgroundColor: c.text }} />
          </View>
          <View style={{ width: 2, height: 4, borderRadius: 1, backgroundColor: c.text }} />
        </View>
      </View>
    </View>
  );
}
