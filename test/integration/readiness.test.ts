import { describe, expect, it } from "vitest";
import { observeReadiness } from "../../src/integration/readiness.js";

const manifest = { expectedUrns: ["urn:b", "urn:a"], queryParameters: { surface: "searchAcrossLineage", count: 50 } };
describe("readiness observation", () => {
  it("requires exactly the expected URN set on two consecutive polls", async () => {
    let calls = 0;
    const result = await observeReadiness(manifest, 100, async () => (++calls === 1 ? ["urn:a", "urn:c"] : ["urn:b", "urn:a"]));
    expect(result.disposition).toBe("ready"); expect(result.pollCount).toBe(3); expect(result.expectedSetDigest).toBe(result.observedSetDigest);
  });
  it("rejects matching counts with wrong URNs", async () => {
    const result = await observeReadiness(manifest, 15, async () => ["urn:a", "urn:c"]);
    expect(result.disposition).toBe("not-ready"); expect(result.expectedSetDigest).not.toBe(result.observedSetDigest);
  });
  it("bounds a hanging read by the observation deadline", async () => {
    const result = await observeReadiness(manifest, 10, (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    expect(result.disposition).toBe("deadline-exceeded"); expect(result.pollCount).toBe(1);
  });
  it("records a failed non-JSON or GraphQL reader as failed, never empty", async () => {
    const result = await observeReadiness(manifest, 100, async () => { throw new Error("non-JSON GraphQL response"); });
    expect(result).toMatchObject({ disposition: "read-failed", observedSetDigest: null, pollCount: 1 });
  });
});
