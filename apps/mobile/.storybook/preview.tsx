import type { Preview } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { PhoneFrame } from "../src/storybook/Phone";
import { SchemeOverride, themes } from "../src/ui/theme";

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
          { value: "bare", title: "Tela cheia (lojas)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scheme: "light", frame: "phone" },
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    options: { storySort: { order: ["Fundamentos", "Marca", "Componentes", "Páginas"] } },
  },
  decorators: [
    (Story, ctx) => {
      const scheme = ctx.globals["scheme"] === "dark" ? "dark" : "light";
      const frame = ctx.globals["frame"] === "bare" ? "bare" : "phone";
      return (
        <PhoneFrame.Provider value={frame}>
          <SchemeOverride.Provider value={scheme}>
            <View style={{ minHeight: "100vh" as unknown as number, backgroundColor: ctx.parameters["transparent"] ? "transparent" : themes[scheme].bg }}>
              <Story />
            </View>
          </SchemeOverride.Provider>
        </PhoneFrame.Provider>
      );
    },
  ],
};

export default preview;
