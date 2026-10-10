import { defineConfig } from "vitest/config";

// Unit tests cover the platform-independent model layer and the colour tokens.
export default defineConfig({ test: { include: ["src/model/**/*.test.ts", "src/ui/**/*.test.ts"], environment: "node" } });
