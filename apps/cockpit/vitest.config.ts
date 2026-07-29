import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: {
    __COCKPIT_SOURCE_MODE__: JSON.stringify("placeholder"),
    __COCKPIT_EVENT__: JSON.stringify(null),
    __COCKPIT_COMPARISON__: JSON.stringify(null),
  },
  resolve: {
    alias: { "@contract": fileURLToPath(new URL("../../src/integration/change-impact-event.ts", import.meta.url)), "@comparison": fileURLToPath(new URL("../../src/integration/plan-comparison.ts", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**"],
    setupFiles: [fileURLToPath(new URL("./src/test/setup.ts", import.meta.url))],
  },
});
