import type { StorybookConfig } from "@storybook/react-native-web-vite";

// The design system is written in React Native; react-native-web renders it in the browser.
const config: StorybookConfig = {
  framework: { name: "@storybook/react-native-web-vite", options: {} },
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
};

export default config;
