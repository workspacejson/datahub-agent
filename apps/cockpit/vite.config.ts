import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const sourceMode = process.env.COCKPIT_SOURCE_MODE ?? "placeholder";

if (process.env.NODE_ENV === "production" && sourceMode === "placeholder") {
  throw new Error("Judge and production builds reject COCKPIT_SOURCE_MODE=placeholder.");
}

export default defineConfig({
    resolve: {
    alias: { "@contract": fileURLToPath(new URL("../../src/integration/change-impact-event.ts", import.meta.url)) },
  },
plugins: [react(), tailwindcss()],
  define: { __COCKPIT_SOURCE_MODE__: JSON.stringify(sourceMode) },
});
