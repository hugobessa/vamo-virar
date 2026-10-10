import { createContext, useContext, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { fonts, space, useTheme } from "../ui/theme";
import { ScenarioProvider, type Scenario } from "./scenario";

const HeaderTitle = createContext<(title: string) => void>(() => {});

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
  return (
    <ScenarioProvider scenario={scenario}>
      <SafeAreaProvider>
        <HeaderTitle.Provider value={setOverride}>
          <View style={{ padding: space.xl, alignItems: "center" }}>
            <View style={{ width: 390, maxWidth: "100%", height: 780, borderRadius: 36, borderWidth: 8, borderColor: c.frame, overflow: "hidden", backgroundColor: c.bg }}>
              <View style={{ height: 52, justifyContent: "center", paddingHorizontal: space.l, backgroundColor: c.bg }}>
                <Text numberOfLines={1} style={{ color: c.text, fontFamily: fonts.display, fontSize: 17, fontWeight: "900" }}>
                  {override ?? title}
                </Text>
              </View>
              <View style={{ flex: 1 }}>{children}</View>
            </View>
          </View>
        </HeaderTitle.Provider>
      </SafeAreaProvider>
    </ScenarioProvider>
  );
}
