import { defineConfig, devices } from "@playwright/test";

/**
 * Two servers, because the two failures live in different modes.
 *
 * 4173 is placeholder: the mode that must keep saying so, which is what
 * `shell.spec.ts` asserts. 4174 is fixture: the mode a judge is given, and the
 * only one carrying a real dataset URN. The containment failure this suite now
 * guards was invisible in placeholder mode, because `<dataset-name>` is short
 * enough to fit a column that a real `urn:li:dataset:(...)` bursts.
 */
/** The committed-evidence origin. Renamed from FIXTURE_ORIGIN with the mode. */
export const COMMITTED_ORIGIN = "http://127.0.0.1:4174";

/**
 * Three engines, because the fallback is part of the product.
 *
 * The route transition uses the View Transitions API, which Chromium has and
 * Safari and Firefox support unevenly by version. The code feature-detects and
 * falls back to a plain state update, which is correct, and it also means a
 * judge on Safari sees a materially different moment from the one recorded on
 * Chromium. Running the suite on all three keeps that difference to the
 * transition and nothing else: same content, same layout, same decision above
 * the same fold.
 */
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: [
    // `dev` now defaults to committed, so the placeholder server has to ask for it
    // by name. Before the rename this line served placeholder implicitly, which is
    // the same ambiguity the mode collapse removed.
    { command: "npm run dev:placeholder -- --host 127.0.0.1 --port 4173", port: 4173, reuseExistingServer: !process.env.CI },
    {
      command: "COCKPIT_SOURCE_MODE=committed npm run dev -- --host 127.0.0.1 --port 4174",
      port: 4174,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
