import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const sourceMode = process.env.COCKPIT_SOURCE_MODE ?? "placeholder";

if (process.env.NODE_ENV === "production" && sourceMode === "placeholder") {
  throw new Error("Judge and production builds reject COCKPIT_SOURCE_MODE=placeholder.");
}

/**
 * The event a fixture or live build renders, resolved at build time.
 *
 * Until now `selectCockpitAdapter` threw for every non-placeholder mode — "a
 * fixture or live build requires a bound source adapter" — which made placeholder
 * the only runnable mode and left the fixture path unreachable. The adapter
 * factory and the parity check already existed; nothing supplied them an event.
 *
 * Read here rather than fetched at runtime, deliberately. A judge opening the
 * cockpit should not depend on a running GMS, a network, or a file server; the
 * evidence is committed, so it can be part of the bundle. It also means a build
 * that cannot find its event fails at build time, where the message is legible,
 * rather than rendering an empty shell in a browser.
 *
 * The default is the nested Transfermarkt package, because that is the corpus the
 * judge-facing evidence is about — jaffle remains the regression corpus.
 */
const DEFAULT_EVENT = "../../test/fixtures/golden/change-impact-event.nested.json";
const eventPath = process.env.COCKPIT_EVENT ?? DEFAULT_EVENT;

let event: unknown = null;
if (sourceMode !== "placeholder") {
  const resolved = fileURLToPath(new URL(eventPath, import.meta.url));
  try {
    event = JSON.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    throw new Error(
      `COCKPIT_SOURCE_MODE=${sourceMode} needs an event and could not read one from ${resolved}. ` +
      `Set COCKPIT_EVENT to a committed change-impact event.`,
      { cause },
    );
  }
}

export default defineConfig({
    resolve: {
    alias: { "@contract": fileURLToPath(new URL("../../src/integration/change-impact-event.ts", import.meta.url)), "@comparison": fileURLToPath(new URL("../../src/integration/plan-comparison.ts", import.meta.url)) },
  },
plugins: [react(), tailwindcss()],
  define: { __COCKPIT_SOURCE_MODE__: JSON.stringify(sourceMode), __COCKPIT_EVENT__: JSON.stringify(event) },
});
