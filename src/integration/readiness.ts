import { createHash } from "node:crypto";

export interface ReadinessManifest { expectedUrns: string[]; queryParameters: Record<string, string | number>; }
export interface ReadinessResult {
  expectedSetDigest: string; observedSetDigest: string | null; manifestDigest: string;
  pollCount: number; elapsedMs: number; disposition: "ready" | "not-ready" | "deadline-exceeded" | "read-failed" | "no-expectation";
}

/** Equivalent query parameter maps must produce the same evidence digest. */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const canonicalSet = (values: readonly string[]) => [...new Set(values)].sort();

/** Every poll is bounded by the overall observation deadline, including a hung reader. */
export async function observeReadiness(
  manifest: ReadinessManifest,
  deadlineMs: number,
  read: (signal: AbortSignal) => Promise<string[]>,
  now: () => number = Date.now,
  pollIntervalMs = 25,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ReadinessResult> {
  const started = now(); const expected = canonicalSet(manifest.expectedUrns);

  // An empty expectation cannot attest to anything.
  //
  // Without this, a manifest declaring no expected URNs against an index
  // returning nothing settles as `ready` — and the emitter turns `ready` into
  // `completeness: "verified"`, the strongest word in the vocabulary. The
  // resulting claim is "this dataset definitively has no lineage", earned by
  // declining to say what lineage was expected.
  //
  // That is reachable in exactly the situation HAC-221 was opened for: a
  // lineage index that has not finished converging returns zero, the empty
  // manifest expects zero, the digests match, and index lag is recorded as a
  // settled fact. `verified` requires an external attestation; an empty set is
  // the absence of one, so it is refused here rather than at the call site,
  // where a future second caller would have to remember.
  if (expected.length === 0) {
    return {
      ...{ expectedSetDigest: digest(expected), manifestDigest: digest({ expectedUrns: expected, queryParameters: manifest.queryParameters }) },
      observedSetDigest: null,
      pollCount: 0,
      elapsedMs: 0,
      disposition: "no-expectation",
    };
  }

  const base = { expectedSetDigest: digest(expected), manifestDigest: digest({ expectedUrns: expected, queryParameters: manifest.queryParameters }) };
  let polls = 0; let last: string[] | null = null;
  while (now() - started < deadlineMs) {
    polls += 1;
    const remaining = Math.max(1, deadlineMs - (now() - started));
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), remaining);
    try { last = canonicalSet(await read(controller.signal)); }
    catch { clearTimeout(timer); return { ...base, observedSetDigest: null, pollCount: polls, elapsedMs: now() - started, disposition: controller.signal.aborted ? "deadline-exceeded" : "read-failed" }; }
    clearTimeout(timer);
    // Two consecutive exact set matches are required; a matching count is never sufficient.
    if (JSON.stringify(last) === JSON.stringify(expected)) {
      const controller2 = new AbortController(); const left = Math.max(1, deadlineMs - (now() - started)); const timer2 = setTimeout(() => controller2.abort(), left);
      try {
        const second = canonicalSet(await read(controller2.signal)); polls += 1; clearTimeout(timer2);
        if (JSON.stringify(second) === JSON.stringify(expected)) return { ...base, observedSetDigest: digest(second), pollCount: polls, elapsedMs: now() - started, disposition: "ready" };
        last = second;
      } catch { clearTimeout(timer2); return { ...base, observedSetDigest: last ? digest(last) : null, pollCount: polls + 1, elapsedMs: now() - started, disposition: controller2.signal.aborted ? "deadline-exceeded" : "read-failed" }; }
    }
    const wait = Math.min(pollIntervalMs, Math.max(0, deadlineMs - (now() - started)));
    if (wait > 0) await sleep(wait);
  }
  return { ...base, observedSetDigest: last ? digest(last) : null, pollCount: polls, elapsedMs: now() - started, disposition: "not-ready" };
}
