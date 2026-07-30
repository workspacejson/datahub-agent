import { describe, expect, it } from "vitest";
import { observeReadiness } from "../../src/integration/readiness.js";

const manifest = { expectedUrns: ["urn:b", "urn:a"], queryParameters: { surface: "searchAcrossLineage", count: 50 } };

/**
 * Virtual time, because these tests are about poll semantics and not about how
 * fast the machine is.
 *
 * `now` moves only when `sleep` is awaited, so the loop's deadline arithmetic is
 * decided by the waits the loop itself chooses. Under the real clock these cases
 * asserted that three polls and two 25ms sleeps fit inside a real 100ms budget,
 * which left roughly 50ms for scheduling and failed intermittently under
 * full-suite load while passing in isolation (HAC-285). A test that fails on
 * contention and passes on retry is indistinguishable from one that passes.
 *
 * The seams were already there — `observeReadiness` takes `now` and `sleep`, and
 * the hot-loop case below already injected them. These cases simply did not.
 *
 * Deliberately not used by "bounds a hanging read": that case depends on the real
 * `setTimeout` behind the AbortController, which virtual time does not drive.
 */
function virtualClock() {
  let elapsed = 0;
  let sleeps = 0;
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      sleeps += 1;
      elapsed += ms;
    },
    get sleeps() {
      return sleeps;
    },
  };
}

describe("readiness observation", () => {
  it("requires exactly the expected URN set on two consecutive polls", async () => {
    let calls = 0;
    const clock = virtualClock();
    const result = await observeReadiness(
      manifest,
      100,
      async () => (++calls === 1 ? ["urn:a", "urn:c"] : ["urn:b", "urn:a"]),
      clock.now,
      25,
      clock.sleep,
    );
    expect(result.disposition).toBe("ready");
    expect(result.pollCount).toBe(3);
    expect(result.expectedSetDigest).toBe(result.observedSetDigest);
    // One wait, between the mismatching first poll and the pair that agreed.
    // Exact because virtual time makes it exact; under the real clock this was
    // asserted as `<= 100` and was the assertion that flaked.
    expect(result.elapsedMs).toBe(25);
  });

  it("does not settle when the first poll matches but the second does not", async () => {
    let calls = 0;
    const clock = virtualClock();
    const result = await observeReadiness(
      manifest,
      100,
      async () => {
        calls += 1;
        return calls === 1 ? ["urn:a", "urn:b"] : ["urn:a", "urn:c"];
      },
      clock.now,
      25,
      clock.sleep,
    );
    expect(result.disposition).not.toBe("ready");
    expect(result.pollCount).toBeGreaterThan(1);
    // The deadline is what stopped it, not a read failure.
    expect(result.disposition).toBe("not-ready");
  });

  it("rejects matching counts with wrong URNs", async () => {
    const clock = virtualClock();
    const result = await observeReadiness(manifest, 15, async () => ["urn:a", "urn:c"], clock.now, 25, clock.sleep);
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
    const clock = virtualClock();
    const result = await observeReadiness(manifest, 30, async () => ["urn:a"], clock.now, 10, clock.sleep);
    expect(result.disposition).toBe("not-ready");
    expect(clock.sleeps).toBeGreaterThan(0);
  });

  it("reports an elapsedMs it actually spent, not a wall-clock reading", async () => {
    // An index that already agrees settles on the first pair of polls, so no
    // wait is taken and no time is spent. Previously asserted as
    // `0 <= elapsedMs <= 100`, which is true of any reading a loaded machine
    // happens to produce and therefore asserted almost nothing.
    const clock = virtualClock();
    const result = await observeReadiness(manifest, 100, async () => ["urn:a", "urn:b"], clock.now, 25, clock.sleep);
    expect(result.disposition).toBe("ready");
    expect(result.elapsedMs).toBe(0);
    expect(clock.sleeps).toBe(0);
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
