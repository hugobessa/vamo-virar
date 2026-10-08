import { defineConfig } from "vitest/config";

// Unit tests cover the platform-independent model layer only.
export default defineConfig({ test: { include: ["src/model/**/*.test.ts"], environment: "node" } });
