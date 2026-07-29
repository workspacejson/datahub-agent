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

/**
 * Two provenance kinds, and they make different claims.
 *
 * **derived** — a real run with named changes applied. It can and must list
 * every transformation, because the list is the only thing separating "a real
 * run, modified in these four ways" from "a plausible arrangement of strings".
 *
 * **captured** — a real run, copied in unchanged. It has no transformation list
 * because nothing was transformed, and demanding one pushes toward inventing
 * one. Its guarantee is stronger and narrower: byte-identical to the recorded
 * run it names.
 *
 * Some states cannot be derived at all. The demo corpus resolves 23/23, so there
 * is no natural residual for partial resolution to degrade into — editing a
 * resolving run into an unresolved one would author the exact claim the state
 * exists to make checkable. Until 2026-07-29 this harness asserted
 * `transformation.length > 0` for every fixture, which encoded "derived" as
 * universal and had no way to hold a capture.
 */
const FIXTURES = [
  {
    name: "accepted-not-observed",
    kind: "derived",
    state: "Mutation accepted; intended state not observed",
  },
  {
    name: "partial-resolution",
    kind: "captured",
    state: "Resolution incomplete; every unresolved dataset named",
  },
] as const;

describe.each(FIXTURES)("the $name state fixture ($kind)", ({ name, kind, state }) => {
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

  it("declares which provenance claim it is making", () => {
    // Without this the two kinds are told apart by which fields happen to be
    // present, and a derived fixture that lost its transformation list would
    // read as a capture rather than as broken.
    expect(sidecar.kind).toBe(kind);
  });

  it("matches the digest its own sidecar records", () => {
    // Catches a fixture edited in place after generation — the failure mode the
    // whole derive-don't-author rule is aimed at.
    const body = readFileSync(join(states, file), "utf8");
    expect(createHash("sha256").update(body).digest("hex")).toBe(sidecar.fixtureSha256);
  });

  it("is regenerated, not maintained: re-running the script reproduces it byte for byte", () => {
    // Covers both kinds. For a capture the operation is identity, which is
    // exactly the guarantee wanted: the fixture and the recorded run cannot
    // silently diverge.
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const before = readFileSync(join(states, file), "utf8");
    execFileSync(process.execPath, [join(root, "scripts/derive-state-fixtures.mjs")], { cwd: root });
    expect(readFileSync(join(states, file), "utf8")).toBe(before);
  });
});

describe.each(FIXTURES.filter((f) => f.kind === "derived"))("the $name fixture, as a derivation", ({ name }) => {
  const sidecar = read(`change-impact-event.${name}.provenance.json`);

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

  it("says what the real observation was, beside the one it inverts", () => {
    // A fixture that flips an observation and does not record the original
    // leaves a reader unable to tell a modelled failure from a measured one.
    expect(sidecar.baseObservation.status).toBe("settled");
    expect(sidecar.baseObservation.readTier).toBe("unknown");
  });
});

describe.each(FIXTURES.filter((f) => f.kind === "captured"))("the $name fixture, as a capture", ({ name }) => {
  const file = `change-impact-event.${name}.json`;
  const sidecar = read(`change-impact-event.${name}.provenance.json`);

  it("names the recorded run it came from, and is byte-identical to it", () => {
    // This replaces the transformation list. A capture cannot enumerate changes
    // because it made none, so the equivalent guarantee is that no change
    // occurred — checked against the source rather than asserted in prose.
    const source = readFileSync(join(root, sidecar.capturedFrom));
    expect(createHash("sha256").update(source).digest("hex")).toBe(sidecar.capturedFromSha256);
    expect(readFileSync(join(states, file), "utf8")).toBe(source.toString("utf8"));
  });

  it("claims no transformation, because a capture that transformed something is a derivation", () => {
    expect(sidecar.transformation).toBeUndefined();
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

describe("the partial-resolution fixture reaches the state it claims", () => {
  const event = read("change-impact-event.partial-resolution.json");
  const accounting = event.accounting;

  it("actually failed to resolve something, rather than describing a clean run", () => {
    expect(accounting.datasetsUnresolved).toBeGreaterThan(0);
    expect(accounting.datasetsResolved + accounting.datasetsUnresolved).toBe(accounting.datasetsRequested);
  });

  it("names every unresolved dataset, which is the whole point of the state", () => {
    // HAC-217: "counts alone do not pass". A fixture carrying the count without
    // the names would exercise the honest-fallback branch instead — a different
    // state, and one that was already reachable.
    expect(Array.isArray(accounting.unresolvedRecords)).toBe(true);
    expect(accounting.unresolvedRecords).toHaveLength(accounting.datasetsUnresolved);
  });

  it("gives each name a reason, so the gate's scope requirement is met", () => {
    for (const record of accounting.unresolvedRecords) {
      expect(record.urn.length).toBeGreaterThan(0);
      expect(record.reason.length).toBeGreaterThan(0);
      // A reason that only restates the outcome establishes no scope.
      expect(record.reason.toLowerCase()).not.toBe("unresolved");
    }
  });

  it("names the subject that was actually requested, not some other dataset", () => {
    // The guard against a capture drifting into a fabrication: the unresolved
    // dataset has to be the one the run asked about.
    expect(accounting.unresolvedRecords.map((r: { urn: string }) => r.urn)).toContain(event.subject.urn);
  });

  it("records the resolution as unresolved, so the accounting and the code path agree", () => {
    expect(event.code.method).toBe("unresolved");
    expect(event.code.repositoryRelativePath).toBeNull();
  });
});
