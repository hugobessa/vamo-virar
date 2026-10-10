import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { legalPages } from "./legal";

const dir = dirname(fileURLToPath(import.meta.url));
const here = (p: string) => resolve(dir, p);

// Standalone landing page: the same React Native components as the app, rendered
// with react-native-web, plus the legal pages built from docs/*.md.
export default defineConfig(({ mode }) => ({
  root: here("."),
  plugins: [react(), legalPages()],
  resolve: {
    alias: {
      "react-native": "react-native-web",
      "react-native-safe-area-context": here("stubs/safe-area.tsx"),
    },
    extensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js", ".json"],
  },
  define: { __DEV__: JSON.stringify(mode !== "production") },
  build: { outDir: here("../dist-landing"), emptyOutDir: true, target: "es2020" },
}));
