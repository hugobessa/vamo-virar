import type { Preview } from "@storybook/react-native-web-vite";
import { useEffect } from "react";
import { View } from "react-native";
import { PhoneFrame } from "../src/storybook/Phone";
import { ReducedMotionOverride, SchemeOverride, themes } from "../src/ui/theme";

/** Mirrors the toolbar's motion choice onto <html>, where the landing page's CSS reads it. */
function MotionFlag({ on }: { on: boolean }) {
  useEffect(() => {
    document.documentElement.dataset["vvMotion"] = on ? "on" : "off";
    return () => {
      delete document.documentElement.dataset["vvMotion"];
    };
  }, [on]);
  return null;
}

const preview: Preview = {
  globalTypes: {
    scheme: {
      description: "Tema",
      toolbar: {
        title: "Tema",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Claro" },
          { value: "dark", title: "Escuro" },
        ],
        dynamicTitle: true,
      },
    },
    frame: {
      description: "Moldura das telas",
      toolbar: {
        title: "Moldura",
        icon: "mobile",
        items: [
          { value: "phone", title: "Celular" },
          { value: "desktop", title: "Computador (web)" },
          { value: "bare", title: "Tela cheia (lojas)" },
        ],
        dynamicTitle: true,
      },
    },
    motion: {
      description: "Movimento (simula a preferência de menos movimento do sistema)",
      toolbar: {
        title: "Movimento",
        icon: "play",
        items: [
          { value: "on", title: "Movimento ligado" },
          { value: "off", title: "Menos movimento" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scheme: "light", frame: "phone", motion: "on" },
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    options: { storySort: { order: ["Fundamentos", "Marca", "Componentes", "Páginas"] } },
  },
  decorators: [
    (Story, ctx) => {
      const scheme = ctx.globals["scheme"] === "dark" ? "dark" : "light";
      const frame = ctx.globals["frame"] === "bare" ? "bare" : ctx.globals["frame"] === "desktop" ? "desktop" : "phone";
      const reduced = ctx.globals["motion"] === "off";
      return (
        <PhoneFrame.Provider value={frame}>
          <SchemeOverride.Provider value={scheme}>
            <ReducedMotionOverride.Provider value={reduced}>
              <MotionFlag on={!reduced} />
              <View style={{ minHeight: "100vh" as unknown as number, backgroundColor: ctx.parameters["transparent"] ? "transparent" : themes[scheme].bg }}>
                <Story />
              </View>
            </ReducedMotionOverride.Provider>
          </SchemeOverride.Provider>
        </PhoneFrame.Provider>
      );
    },
  ],
};

export default preview;
