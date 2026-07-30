/**
 * Process-level tests for `scripts/run-writeback.mjs`.
 *
 * Three defects of one class reached merged `main` in this project, and all
 * three lived in the same place: the seam between thoroughly tested pure
 * functions and a script nothing exercised. The unit tests around
 * `deriveOutcome` prove the *verdict* is right given evidence. They cannot
 * prove the script gathers that evidence correctly, bounds its polling, keeps
 * stdout parseable, or exits with a status anyone can branch on.
 *
 * So these drive the real binary against a stub GraphQL endpoint. The stub is
 * scripted rather than recorded, because the cases that matter — a write that
 * is applied but not yet visible, a write that never becomes visible, an
 * instance that stops answering — are precisely the ones a live quickstart will
 * not reproduce on demand.
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  EVIDENCE_TIER_PROPERTY_ID,
  LINK_LABEL,
  type EnrichedChangeImpactEvent,
} from "../../src/integration/writeback.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(repoRoot, "scripts/run-writeback.mjs");
const eventPath = join(repoRoot, "test/fixtures/golden/change-impact-event.nested.json");

const EVENT = JSON.parse(readFileSync(eventPath, "utf8")) as EnrichedChangeImpactEvent;
const INTENDED_LINK = EVENT.code.sourceUrl!;
const INTENDED_TIER = EVENT.evidence.tier;
const PROPERTY_URN = `urn:li:structuredProperty:${EVIDENCE_TIER_PROPERTY_ID}`;

/** Bounds small enough to keep a timeout case fast, large enough to poll more than once. */
const TIMEOUT_MS = 900;
const INTERVAL_MS = 150;

interface StubBehavior {
  /** Reads after the mutations that still show the old state. */
  staleReads?: number;
  /** Never show the write, so the observation must hit its bound. */
  neverConverges?: boolean;
  /** Answer every read with a non-JSON error body. */
  failReads?: boolean;
  /**
   * Accept post-mutation reads and never answer them. This is the case a
   * between-reads deadline cannot bound: the request is in flight, so nothing
   * re-checks the clock until the socket resolves.
   */
  hangReadsAfterMutation?: boolean;
}

interface Stub {
  url: string;
  /** Every GraphQL document the script sent, in order. */
  requests: Array<{ kind: "read" | "mutation"; name: string }>;
  close: () => Promise<void>;
}

const emptyDataset = {
  data: { dataset: { institutionalMemory: { elements: [] }, structuredProperties: { properties: [] } } },
};

const enrichedDataset = {
  data: {
    dataset: {
      institutionalMemory: { elements: [{ url: INTENDED_LINK, label: LINK_LABEL }] },
      structuredProperties: {
        properties: [
          { structuredProperty: { urn: PROPERTY_URN }, values: [{ stringValue: INTENDED_TIER }] },
        ],
      },
    },
  },
};

async function startStub(behavior: StubBehavior = {}): Promise<Stub> {
  const requests: Stub["requests"] = [];
  let mutationsApplied = false;
  let readsAfterMutation = 0;

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { query } = JSON.parse(body) as { query: string };
      const isRead = query.trimStart().startsWith("query");
      const name = isRead
        ? "readState"
        : (query.match(/createStructuredProperty|upsertLink|upsertStructuredProperties/)?.[0] ??
          "unknown");
      requests.push({ kind: isRead ? "read" : "mutation", name });

      const send = (status: number, payload: unknown, raw = false): void => {
        res.writeHead(status, { "Content-Type": raw ? "text/plain" : "application/json" });
        res.end(raw ? String(payload) : JSON.stringify(payload));
      };

      if (isRead) {
        if (behavior.failReads) return send(502, "upstream is down, and this is not JSON", true);
        if (!mutationsApplied) return send(200, emptyDataset);
        // Deliberately never respond: the socket stays open until the client
        // gives up or the stub is torn down.
        if (behavior.hangReadsAfterMutation) return;
        readsAfterMutation += 1;
        const stillStale =
          behavior.neverConverges === true || readsAfterMutation <= (behavior.staleReads ?? 0);
        return send(200, stillStale ? emptyDataset : enrichedDataset);
      }

      mutationsApplied = true;
      if (name === "createStructuredProperty") {
        return send(200, { data: { createStructuredProperty: { urn: PROPERTY_URN } } });
      }
      if (name === "upsertLink") return send(200, { data: { upsertLink: true } });
      return send(200, {
        data: { upsertStructuredProperties: { properties: [{ structuredProperty: { urn: PROPERTY_URN } }] } },
      });
    });
  });

  // A hung request holds its socket open, and server.close() waits for every
  // connection. Track them so teardown cannot stall the suite.
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the real script. Never rejects — a non-zero exit is a result, not an error. */
function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, eventPath, ...args], { cwd: repoRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const bounded = (stub: Stub): string[] => [
  "--gms",
  stub.url,
  "--observe-timeout",
  String(TIMEOUT_MS),
  "--observe-interval",
  String(INTERVAL_MS),
];

/** The receipt as the script actually emitted it, parsed from stdout. */
const receiptFrom = (result: CliResult) =>
  (JSON.parse(result.stdout) as EnrichedChangeImpactEvent).writeback!;

let stub: Stub | null = null;
afterEach(async () => {
  await stub?.close();
  stub = null;
});

describe("a write that lands but is not visible yet", () => {
  it("polls past the stale reads and settles on the intended state", async () => {
    // The case the receipt used to get wrong in the other direction: mutations
    // return cleanly, the first read still shows nothing. Reading once would
    // have called this a failure; not checking intent at all would have called
    // it a success without looking.
    stub = await startStub({ staleReads: 2 });
    const result = await runCli(bounded(stub));
    const receipt = receiptFrom(result);

    expect(receipt.observation?.status).toBe("settled");
    expect(receipt.observation?.polls).toBe(3);
    expect(receipt.succeeded).toBe(true);
    expect(result.code).toBe(0);
  }, 20_000);

  it("reports the state it finally observed, not the first thing it was told", async () => {
    stub = await startStub({ staleReads: 1 });
    const receipt = receiptFrom(await runCli(bounded(stub)));

    expect(receipt.after.linkUrl).toBe(INTENDED_LINK);
    expect(receipt.after.evidenceTier).toBe(INTENDED_TIER);
    expect(receipt.after.read).toBe("ok");
  }, 20_000);
});

describe("a write that never becomes visible", () => {
  it("gives up at the bound and refuses to claim success", async () => {
    // Every mutation returned 200. Both reads completed. The old `succeeded`
    // was true here — this is the defect, driven end to end.
    stub = await startStub({ neverConverges: true });
    const result = await runCli(bounded(stub));
    const receipt = receiptFrom(result);

    expect(receipt.observation?.status).toBe("timed-out");
    expect(receipt.succeeded).toBe(false);
    expect(result.code).not.toBe(0);
    expect(receipt.attempts.every((a) => a.succeeded)).toBe(true);
  }, 20_000);

  it("keeps a timeout distinct from a failed read", async () => {
    // The reads worked. What failed was the write becoming visible, and a
    // receipt that called that an unreadable instance would send a reviewer
    // after the wrong thing.
    stub = await startStub({ neverConverges: true });
    const receipt = receiptFrom(await runCli(bounded(stub)));

    expect(receipt.observation?.status).not.toBe("failed");
    expect(receipt.after.read).toBe("ok");
    expect(receipt.observation?.lastError).toBeNull();
    expect(receipt.bothStatesRead).toBe(true);
  }, 20_000);

  it("records the bound it applied, so the timeout can be read against it", async () => {
    stub = await startStub({ neverConverges: true });
    const receipt = receiptFrom(await runCli(bounded(stub)));

    expect(receipt.observation?.timeoutMs).toBe(TIMEOUT_MS);
    expect(receipt.observation?.polls).toBeGreaterThan(1);
    // One poll interval of slack, deliberately.
    //
    // `elapsedMs` is sampled after the final read returns, and the final read
    // is itself budget-bounded — so under CPU contention the abort handling and
    // the measurement can land a few milliseconds past the deadline. Asserting
    // `<= TIMEOUT_MS` exactly was asserting zero scheduling overhead, and it
    // failed intermittently under full-suite load while passing in isolation.
    //
    // The slack does not weaken what this test is for. The defect it guards
    // (HAC-223) produced elapsedMs ≈ 30003 against a 1800ms bound, because each
    // request carried its own 30s ceiling instead of the remaining observation
    // budget. A 150ms tolerance on a 900ms bound still discriminates that by
    // more than an order of magnitude.
    expect(receipt.observation?.elapsedMs).toBeLessThanOrEqual(TIMEOUT_MS + INTERVAL_MS);
  }, 20_000);
});

describe("an instance that accepts a read and never answers", () => {
  // The case a between-reads deadline cannot bound. `gql` gives every request
  // its own 30s ceiling, so before this was fixed a 900ms bound would sit on a
  // hung socket for thirty seconds and then report an elapsedMs thirty times
  // the bound it claimed to have applied. A deadline that only takes effect
  // between reads is not a deadline.

  it("gives up at the bound rather than at the request timeout", async () => {
    stub = await startStub({ hangReadsAfterMutation: true });
    const startedAt = Date.now();
    const result = await runCli(bounded(stub));
    const wallClockMs = Date.now() - startedAt;

    // Generous enough to absorb process spawn, strict enough that the old
    // fixed 30s request ceiling could not pass it.
    expect(wallClockMs).toBeLessThan(10_000);
    expect(result.code).not.toBe(0);
  }, 60_000);

  it("advertises the bound it was given and does not claim the catalog answered", async () => {
    // This asserted `elapsedMs <= TIMEOUT_MS * 2` and flaked at 2202ms against
    // 1800ms under full-suite load (HAC-285). The duration assertion is gone
    // rather than widened a second time.
    //
    // Widening was the wrong move twice over. The sibling assertion above had
    // already been loosened once for the same reason, and a bound loose enough
    // to survive contention is no longer measuring the defect — it is measuring
    // whether the machine was busy. The magnitude claim it was reaching for is
    // carried by "gives up at the bound rather than at the request timeout"
    // above, whose threshold is derived from the defect (10s against the 30s
    // ceiling HAC-223 actually produced) rather than from the ideal 900ms, so it
    // has a 3x margin and cannot flake on scheduling.
    //
    // What is left here is the part that does not need a clock: the receipt must
    // advertise the bound it was handed, and must not report an observation
    // status that claims the catalog answered when the read hung. `settled`
    // would be exactly that claim.
    stub = await startStub({ hangReadsAfterMutation: true });
    const receipt = receiptFrom(await runCli(bounded(stub)));

    expect(receipt.observation?.timeoutMs).toBe(TIMEOUT_MS);
    expect(receipt.observation?.status).not.toBe("settled");
    expect(receipt.observation?.polls).toBeGreaterThan(0);
  }, 60_000);

  it("records the cancelled read as failed, with the cause preserved", async () => {
    // The read did not complete. That is `failed`, not `timed-out` — the
    // latter would claim the catalog answered and showed the wrong thing.
    stub = await startStub({ hangReadsAfterMutation: true });
    const receipt = receiptFrom(await runCli(bounded(stub)));

    expect(receipt.after.read).toBe("failed");
    expect(receipt.observation?.status).toBe("failed");
    expect(receipt.observation?.lastError).toMatch(/Timeout|Abort/i);
    expect(receipt.succeeded).toBe(false);
    expect(receipt.bothStatesRead).toBe(false);
  }, 60_000);

  it("still emits a complete receipt, because a hang must not swallow one", async () => {
    stub = await startStub({ hangReadsAfterMutation: true });
    const result = await runCli(bounded(stub));

    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(receiptFrom(result).attempts.every((a) => a.succeeded)).toBe(true);
  }, 60_000);
});

describe("an instance that stops answering", () => {
  it("emits a receipt anyway, marks the states unreadable, and exits non-zero", async () => {
    // The promise the script makes: a silent failure is the outcome it exists
    // to prevent, so no transport error may escape past the receipt.
    stub = await startStub({ failReads: true });
    const result = await runCli(bounded(stub));
    const receipt = receiptFrom(result);

    expect(receipt.before.read).toBe("failed");
    expect(receipt.after.read).toBe("failed");
    expect(receipt.observation?.status).toBe("failed");
    expect(receipt.succeeded).toBe(false);
    expect(receipt.bothStatesRead).toBe(false);
    expect(result.code).not.toBe(0);
  }, 20_000);

  it("preserves the cause rather than reporting a bare failure", async () => {
    stub = await startStub({ failReads: true });
    const receipt = receiptFrom(await runCli(bounded(stub)));

    expect(receipt.before.readError).toMatch(/502|non-JSON/);
    expect(receipt.observation?.lastError).toMatch(/502|non-JSON/);
  }, 20_000);

  it("never presents an unreachable instance as an empty catalog", async () => {
    // before=absent / after=absent on an instance nobody reached would look
    // like a clean, honest write that simply did nothing.
    stub = await startStub({ failReads: true });
    const receipt = receiptFrom(await runCli(bounded(stub)));

    expect(receipt.noop).toBe(false);
  }, 20_000);
});

describe("a dry run", () => {
  it("writes nothing at all, and the endpoint can prove it", async () => {
    stub = await startStub();
    const result = await runCli([...bounded(stub), "--dry-run"]);

    expect(stub.requests).toEqual([]);
    expect(receiptFrom(result).attempts).toEqual([]);
    expect(result.code).toBe(0);
  }, 20_000);

  it("records not-queried, which is not a failure", async () => {
    // A dry run chose not to read. Calling that `failed` would report a
    // decision as a fault — the same collapse the contract exists to prevent.
    stub = await startStub();
    const receipt = receiptFrom(await runCli([...bounded(stub), "--dry-run"]));

    expect(receipt.before.read).toBe("not-queried");
    expect(receipt.after.read).toBe("not-queried");
    expect(receipt.observation).toBeNull();
  }, 20_000);

  it("claims nothing, rather than claiming a noop", async () => {
    stub = await startStub();
    const receipt = receiptFrom(await runCli([...bounded(stub), "--dry-run"]));

    expect(receipt.succeeded).toBe(false);
    expect(receipt.noop).toBe(false);
    expect(receipt.bothStatesRead).toBe(false);
  }, 20_000);
});

describe("the streams a caller depends on", () => {
  it("puts one complete JSON document on stdout and nothing else", async () => {
    // The receipt is the product, and the documented invocation pipes it. A
    // diagnostic leaking into stdout would corrupt every downstream consumer.
    stub = await startStub({ staleReads: 1 });
    const result = await runCli(bounded(stub));

    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout.trimStart().startsWith("{")).toBe(true);
    expect(result.stdout.trimEnd().endsWith("}")).toBe(true);
  }, 20_000);

  it("keeps stdout parseable even when the run failed", async () => {
    // The failing path is the one a consumer is least likely to have tested.
    stub = await startStub({ neverConverges: true });
    const result = await runCli(bounded(stub));

    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(receiptFrom(result).succeeded).toBe(false);
  }, 20_000);

  it("keeps every diagnostic on stderr, including the observation summary", async () => {
    stub = await startStub({ staleReads: 1 });
    const result = await runCli(bounded(stub));

    expect(result.stderr).toMatch(/observation\s+settled/);
    expect(result.stderr).toMatch(/succeeded/);
    expect(result.stdout).not.toMatch(/observation\s+settled/);
  }, 20_000);

  it("sends the receipt to a file and the notice to stderr, never swapping them", async () => {
    stub = await startStub({ staleReads: 1 });
    const out = join(mkdtempSync(join(tmpdir(), "writeback-cli-")), "receipt.json");
    const result = await runCli([...bounded(stub), "--out", out]);

    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/written to/);
    expect(JSON.parse(readFileSync(out, "utf8")).writeback.succeeded).toBe(true);
  }, 20_000);
});

describe("the observation bound itself", () => {
  it("refuses a non-numeric bound instead of looping forever", async () => {
    // An unbounded loop is the one way this script could hang rather than
    // emit a receipt, which would defeat its entire promise.
    stub = await startStub({ staleReads: 1 });
    const result = await runCli(["--gms", stub.url, "--observe-timeout", "not-a-number", "--dry-run"]);

    expect(result.stderr).toMatch(/must be a positive number/);
    expect(result.code).toBe(0);
  }, 20_000);
});
