import { describe, expect, it } from "vitest";
import { observeReadiness } from "../../src/integration/readiness.js";

const manifest = { expectedUrns: ["urn:b", "urn:a"], queryParameters: { surface: "searchAcrossLineage", count: 50 } };

describe("readiness observation", () => {
  it("requires exactly the expected URN set on two consecutive polls", async () => {
    let calls = 0;
    const result = await observeReadiness(manifest, 100, async () => (++calls === 1 ? ["urn:a", "urn:c"] : ["urn:b", "urn:a"]));
    expect(result.disposition).toBe("ready");
    expect(result.pollCount).toBe(3);
    expect(result.expectedSetDigest).toBe(result.observedSetDigest);
  });

  it("does not settle when the first poll matches but the second does not", async () => {
    let calls = 0;
    const result = await observeReadiness(manifest, 100, async () => {
      calls += 1;
      return calls === 1 ? ["urn:a", "urn:b"] : ["urn:a", "urn:c"];
    });
    expect(result.disposition).not.toBe("ready");
    expect(result.pollCount).toBeGreaterThan(1);
  });

  it("rejects matching counts with wrong URNs", async () => {
    const result = await observeReadiness(manifest, 15, async () => ["urn:a", "urn:c"]);
    expect(result.disposition).toBe("not-ready");
    expect(result.expectedSetDigest).not.toBe(result.observedSetDigest);
  });

  it("bounds a hanging read by the observation deadline", async () => {
    const result = await observeReadiness(manifest, 10, (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    expect(result.disposition).toBe("deadline-exceeded");
    expect(result.pollCount).toBe(1);
  });

  it("records a failed non-JSON or GraphQL reader as failed, never empty", async () => {
    const result = await observeReadiness(manifest, 100, async () => { throw new Error("non-JSON GraphQL response"); });
    expect(result.disposition).toBe("read-failed");
    expect(result.observedSetDigest).toBeNull();
    expect(result.pollCount).toBe(1);
  });

  it("canonicalizes query-parameter key order in the manifest digest", async () => {
    const a = await observeReadiness({ expectedUrns: ["urn:a"], queryParameters: { count: 50, surface: "lineage" } }, 100, async () => ["urn:a"]);
    const b = await observeReadiness({ expectedUrns: ["urn:a"], queryParameters: { surface: "lineage", count: 50 } }, 100, async () => ["urn:a"]);
    expect(a.manifestDigest).toBe(b.manifestDigest);
  });

  it("canonicalizes expected URN order in the set digest", async () => {
    const a = await observeReadiness({ expectedUrns: ["urn:a", "urn:b"], queryParameters: {} }, 100, async () => ["urn:a", "urn:b"]);
    const b = await observeReadiness({ expectedUrns: ["urn:b", "urn:a"], queryParameters: {} }, 100, async () => ["urn:a", "urn:b"]);
    expect(a.expectedSetDigest).toBe(b.expectedSetDigest);
  });

  it("waits between unsuccessful polls instead of hot-looping", async () => {
    let sleeps = 0;
    let current = 0;
    const result = await observeReadiness(manifest, 30, async () => ["urn:a"], () => current, 10, async (ms) => { sleeps += 1; current += ms; });
    expect(result.disposition).toBe("not-ready");
    expect(sleeps).toBeGreaterThan(0);
  });

  it("reports an elapsedMs inside the deadline", async () => {
    const result = await observeReadiness(manifest, 100, async () => ["urn:a", "urn:b"]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.elapsedMs).toBeLessThanOrEqual(100);
  });

  it("refuses to attest from an empty expected URN set", async () => {
    // This previously asserted `ready`, which the emitter turns into
    // `completeness: "complete-against-pinned-manifest"` — so a manifest that declared no expectation
    // earned the strongest completeness claim in the vocabulary. Reachable in
    // exactly the HAC-221 case: an unconverged index returns zero, an empty
    // manifest expects zero, and index lag is recorded as a settled fact.
    const result = await observeReadiness({ expectedUrns: [], queryParameters: {} }, 100, async () => []);
    expect(result.disposition).toBe("no-expectation");
    expect(result.observedSetDigest).toBeNull();
    expect(result.pollCount).toBe(0);
  });

  it("never reads the catalog when there is no expectation to check against", () => {
    let reads = 0;
    return observeReadiness({ expectedUrns: [], queryParameters: {} }, 100, async () => { reads += 1; return []; })
      .then(() => expect(reads).toBe(0));
  });
});
