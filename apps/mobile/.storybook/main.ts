import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-native-web-vite";
import { mergeConfig } from "vite";

const mocks = fileURLToPath(new URL("../src/storybook", import.meta.url));

// Screens import these app modules; stories get stand-ins that need no store, keys or calendar.
const appModules: Record<string, string> = {
  "/lib/context": "context.tsx",
  "/lib/storage": "storage.ts",
  "/lib/matching": "matching.ts",
  "/lib/confirm": "confirm.ts",
};

// The design system is written in React Native; react-native-web renders it in the browser.
const config: StorybookConfig = {
  framework: { name: "@storybook/react-native-web-vite", options: {} },
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  viteFinal: (config) =>
    mergeConfig(config, {
      plugins: [
        {
          name: "vv-mock-app-modules",
          enforce: "pre",
          resolveId(source: string, importer?: string) {
            if (!importer || importer.includes("/src/storybook/")) return null;
            for (const [suffix, file] of Object.entries(appModules)) {
              if (source.endsWith(suffix)) return `${mocks}/${file}`;
            }
            return null;
          },
        },
      ],
      resolve: {
        alias: {
          "expo-router": `${mocks}/expo-router.tsx`,
          "expo-auth-session": `${mocks}/expo-auth-session.ts`,
          "expo-constants": `${mocks}/expo-constants.ts`,
          "expo-web-browser": `${mocks}/expo-web-browser.ts`,
          "expo-crypto": `${mocks}/expo-crypto.ts`,
        },
      },
    }),
};

export default config;
