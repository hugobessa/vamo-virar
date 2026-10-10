import type { Preview } from "@storybook/react-native-web-vite";
import { View } from "react-native";
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
  },
  initialGlobals: { scheme: "light" },
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    options: { storySort: { order: ["Fundamentos", "Marca", "Componentes", "Páginas"] } },
  },
  decorators: [
    (Story, ctx) => {
      const scheme = ctx.globals["scheme"] === "dark" ? "dark" : "light";
      return (
        <SchemeOverride.Provider value={scheme}>
          <View style={{ minHeight: "100vh" as unknown as number, backgroundColor: themes[scheme].bg }}>
            <Story />
          </View>
        </SchemeOverride.Provider>
      );
    },
  ],
};

export default preview;
