/**
 * The degraded-state fixtures, held to three things at once.
 *
 * A state fixture is only worth committing if it (1) still validates as a real
 * event under the frozen contract, (2) actually reaches the state it claims to
 * cover, and (3) is traceable to a run that happened. Drop any one and it
 * becomes demo JSON with a filename — which is the thing HAC-145 exists to
 * forbid, arriving through the door marked "test fixture".
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { emittedEventSchema } from "../../src/integration/change-impact-event.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const states = join(root, "test/fixtures/golden/states");

const read = (file: string) => JSON.parse(readFileSync(join(states, file), "utf8"));

const FIXTURES = [
  { name: "accepted-not-observed", state: "Mutation accepted; intended state not observed" },
] as const;

describe.each(FIXTURES)("the $name state fixture", ({ name, state }) => {
  const file = `change-impact-event.${name}.json`;
  const sidecar = read(`change-impact-event.${name}.provenance.json`);

  it("is still a valid event under the frozen contract", () => {
    // A degraded state is a state the product can actually be in. If the fixture
    // no longer parses, it is describing a shape the emitter cannot produce, and
    // whatever the cockpit does with it proves nothing.
    expect(emittedEventSchema.safeParse(read(file)).success).toBe(true);
  });

  it("names the ratified state it covers", () => {
    expect(sidecar.state).toBe(state);
    expect(sidecar.why).toMatch(/HAC-217/);
  });

  it("is derived from a real run, and says which one", () => {
    // The residuals and provenance have to trace back to something that
    // happened. Hand-authored values would be plausible strings asserting
    // exactly what the state exists to make checkable.
    expect(sidecar.derivedFrom).toBe("evaluation/hac-152/live-event-with-writeback.json");
    const base = readFileSync(join(root, sidecar.derivedFrom));
    expect(createHash("sha256").update(base).digest("hex")).toBe(sidecar.derivedFromSha256);
  });

  it("records every transformation applied to the base, not just that there were some", () => {
    expect(Array.isArray(sidecar.transformation)).toBe(true);
    expect(sidecar.transformation.length).toBeGreaterThan(0);
    for (const step of sidecar.transformation) expect(step).toMatch(/:/);
  });

  it("matches the digest its own sidecar records", () => {
    // Catches a fixture edited in place after derivation — the failure mode the
    // whole derive-don't-author rule is aimed at.
    const body = readFileSync(join(states, file), "utf8");
    expect(createHash("sha256").update(body).digest("hex")).toBe(sidecar.fixtureSha256);
  });

  it("is regenerated, not maintained: re-running the script reproduces it byte for byte", () => {
    // If the committed fixture and a fresh derivation disagree, one of them has
    // been hand-edited, and the sidecar's account of how it was made is fiction.
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const before = readFileSync(join(states, file), "utf8");
    execFileSync(process.execPath, [join(root, "scripts/derive-state-fixtures.mjs")], { cwd: root });
    expect(readFileSync(join(states, file), "utf8")).toBe(before);
  });
});

describe("the accepted-not-observed fixture reaches the state it claims", () => {
  const writeback = read("change-impact-event.accepted-not-observed.json").writeback;

  it("has every mutation attempt succeed, so the mutation is genuinely accepted", () => {
    expect(writeback.attempts.length).toBeGreaterThan(0);
    expect(writeback.attempts.every((a: { succeeded: boolean }) => a.succeeded)).toBe(true);
  });

  it("never observes the intended state, so acceptance cannot be read as success", () => {
    expect(writeback.observation.status).toBe("timed-out");
    expect(writeback.succeeded).toBe(false);
  });

  it("keeps the after-state read successful while showing the pre-mutation answer", () => {
    // The read completing and the read showing intent are two facts. A fixture
    // that failed the read would exercise a different state entirely — one
    // HAC-217 defers — and would prove nothing about this one.
    expect(writeback.after.read).toBe("ok");
    expect(writeback.bothStatesRead).toBe(true);
    expect(writeback.after.evidenceTier).toBe(writeback.before.evidenceTier);
    expect(writeback.after.evidenceTier).not.toBe(writeback.intended.evidenceTier);
  });

  it("is not a noop, which would be a different terminal state", () => {
    expect(writeback.noop).toBe(false);
  });
});
