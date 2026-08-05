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
  EVIDENCE_TIER_PROPERTY_DEFINITION,
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
  /**
   * Answer every *dataset* read with a non-JSON error body.
   *
   * Scoped to dataset reads on purpose. These cases exist to drive the
   * observation loop, and the script now also reads the deployed property
   * definition — which fails closed, so folding it into this knob would stop
   * every one of them before the loop they were written to exercise. The
   * instance-is-entirely-down case is covered separately by
   * `definitionUnreadable`, where the fail-closed refusal is the subject.
   */
  failReads?: boolean;
  /**
   * Accept post-mutation dataset reads and never answer them. This is the case
   * a between-reads deadline cannot bound: the request is in flight, so nothing
   * re-checks the clock until the socket resolves.
   */
  hangReadsAfterMutation?: boolean;
  /** Answer the definition readback with an error, so nothing can be reconciled. */
  definitionUnreadable?: boolean;
  /** Answer the definition readback with no such property. */
  definitionAbsent?: boolean;
  /** Serve a deployed definition that diverges from the one this tool requires. */
  driftDefinition?: (definition: DeployedDefinitionPayload) => DeployedDefinitionPayload;
  /** Report the create mutation as rejected because the property is already defined. */
  propertyAlreadyExists?: boolean;
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

/** The definition readback as GMS shapes it, before the script flattens it. */
interface DeployedDefinitionPayload {
  displayName: string;
  description: string;
  cardinality: string;
  valueType: { urn: string };
  entityTypes: Array<{ urn: string }>;
  allowedValues: Array<{ value: { stringValue: string }; description: string }>;
}

/**
 * A catalog holding exactly what this tool requires, derived from the
 * requirement rather than retyped. A hand-copied fixture here would be a second
 * place the definition lives, which is the defect these tests exist to close.
 */
const deployedDefinition = (): DeployedDefinitionPayload => ({
  displayName: EVIDENCE_TIER_PROPERTY_DEFINITION.displayName,
  description: EVIDENCE_TIER_PROPERTY_DEFINITION.description,
  cardinality: EVIDENCE_TIER_PROPERTY_DEFINITION.cardinality,
  valueType: { urn: EVIDENCE_TIER_PROPERTY_DEFINITION.valueTypeUrn },
  entityTypes: EVIDENCE_TIER_PROPERTY_DEFINITION.entityTypeUrns.map((urn) => ({ urn })),
  allowedValues: EVIDENCE_TIER_PROPERTY_DEFINITION.allowedValues.map((v) => ({
    value: { stringValue: v.stringValue },
    description: v.description,
  })),
});

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
      const isDefinitionRead = isRead && query.includes("structuredProperty(");
      const name = isRead
        ? isDefinitionRead
          ? "readDefinition"
          : "readState"
        : (query.match(/createStructuredProperty|upsertLink|upsertStructuredProperties/)?.[0] ??
          "unknown");
      requests.push({ kind: isRead ? "read" : "mutation", name });

      const send = (status: number, payload: unknown, raw = false): void => {
        res.writeHead(status, { "Content-Type": raw ? "text/plain" : "application/json" });
        res.end(raw ? String(payload) : JSON.stringify(payload));
      };

      if (isDefinitionRead) {
        if (behavior.definitionUnreadable) {
          return send(502, "upstream is down, and this is not JSON", true);
        }
        if (behavior.definitionAbsent) return send(200, { data: { structuredProperty: null } });
        const definition = deployedDefinition();
        return send(200, {
          data: {
            structuredProperty: {
              definition: behavior.driftDefinition
                ? behavior.driftDefinition(definition)
                : definition,
            },
          },
        });
      }

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
        return behavior.propertyAlreadyExists
          ? send(200, {
              errors: [{ message: `Structured property ${PROPERTY_URN} already exists` }],
            })
          : send(200, { data: { createStructuredProperty: { urn: PROPERTY_URN } } });
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

describe("the deployed property definition the tier values mean something under", () => {
  // A tier token is not self-describing. `VERIFIED` in a catalog means what
  // that catalog's property definition says it means, and this tool writes tier
  // values into a catalog it does not own. Until HAC-270's closure the runner
  // reported `already exists` as success outright, so an instance defining
  // `VERIFIED` as something else was indistinguishable from one that agreed —
  // and the receipt claimed the contract was deployed either way.

  it("reads the definition back after creating it, rather than trusting the mutation", async () => {
    // A create that returns a URN does not establish what the server stored.
    stub = await startStub({ staleReads: 1 });
    const result = await runCli(bounded(stub));

    const order = stub.requests.map((r) => r.name);
    expect(order).toContain("readDefinition");
    expect(order.indexOf("readDefinition")).toBeGreaterThan(
      order.indexOf("createStructuredProperty"),
    );
    expect(receiptFrom(result).succeeded).toBe(true);
  }, 20_000);

  it("reconciles an existing definition instead of calling `already exists` success", async () => {
    // The swallow this closes. The mutation is rejected, and the run still
    // succeeds — but on the strength of the readback, not the rejection.
    stub = await startStub({ staleReads: 1, propertyAlreadyExists: true });
    const result = await runCli(bounded(stub));
    const receipt = receiptFrom(result);
    const create = receipt.attempts.find((a) => a.mutation === "createStructuredProperty");

    expect(create?.succeeded).toBe(true);
    expect(create?.response).toContain("already defined");
    expect(create?.response).toContain("reconciled");
    expect(receipt.succeeded).toBe(true);
    expect(result.code).toBe(0);
  }, 20_000);

  it("applies nothing when the deployed definition states a different rule", async () => {
    // The mutation would have been accepted. What stops the write is the
    // meaning the catalog would have published it under.
    stub = await startStub({
      propertyAlreadyExists: true,
      driftDefinition: (definition) => ({
        ...definition,
        allowedValues: definition.allowedValues.map((v) =>
          v.value.stringValue === "VERIFIED"
            ? { ...v, description: "at least one check was executed" }
            : v,
        ),
      }),
    });
    const result = await runCli(bounded(stub));
    const receipt = receiptFrom(result);

    expect(receipt.attempts.map((a) => a.mutation)).toEqual(["createStructuredProperty"]);
    expect(stub.requests.map((r) => r.name)).not.toContain("upsertStructuredProperties");
    expect(stub.requests.map((r) => r.name)).not.toContain("upsertLink");
    expect(receipt.succeeded).toBe(false);
    expect(result.code).not.toBe(0);
  }, 20_000);

  it("names the divergence with both values, so the operator can act on it", async () => {
    stub = await startStub({
      propertyAlreadyExists: true,
      driftDefinition: (definition) => ({ ...definition, description: "Evidence tier." }),
    });
    const result = await runCli(bounded(stub));

    expect(result.stderr).toContain("NOTHING WAS APPLIED");
    expect(result.stderr).toContain("Evidence tier.");
    expect(result.stderr).toContain(EVIDENCE_TIER_PROPERTY_DEFINITION.description.slice(0, 40));
    // Detection and reconciliation, never a silent rewrite of a definition
    // this tool did not create.
    expect(result.stderr).toContain("does not rewrite");
  }, 20_000);

  it("refuses a definition offering a tier the lattice cannot derive", async () => {
    stub = await startStub({
      propertyAlreadyExists: true,
      driftDefinition: (definition) => ({
        ...definition,
        allowedValues: [
          ...definition.allowedValues,
          { value: { stringValue: "TRUSTED" }, description: "hand-set" },
        ],
      }),
    });
    const result = await runCli(bounded(stub));

    expect(receiptFrom(result).succeeded).toBe(false);
    expect(result.stderr).toContain("TRUSTED");
  }, 20_000);

  it("fails closed when the definition cannot be read at all", async () => {
    // Unreadable is not unknown-and-therefore-fine. It is the state where
    // writing a tier value is least defensible, because nothing is known about
    // how that value will be read back.
    stub = await startStub({ definitionUnreadable: true });
    const result = await runCli(bounded(stub));
    const receipt = receiptFrom(result);

    expect(receipt.attempts.map((a) => a.mutation)).toEqual(["createStructuredProperty"]);
    expect(receipt.succeeded).toBe(false);
    expect(result.stderr).toContain("could not be read");
    expect(result.code).not.toBe(0);
  }, 20_000);

  it("fails closed when the property is absent after its own create", async () => {
    stub = await startStub({ definitionAbsent: true });
    const result = await runCli(bounded(stub));

    expect(receiptFrom(result).succeeded).toBe(false);
    expect(result.code).not.toBe(0);
  }, 20_000);

  it("does not poll for a write it deliberately never sent", async () => {
    // Fail closed and then observe would spend the whole bound waiting for a
    // tier nobody submitted, and report a timeout for a decision.
    stub = await startStub({
      propertyAlreadyExists: true,
      driftDefinition: (definition) => ({ ...definition, displayName: "Evidence" }),
    });
    const receipt = receiptFrom(await runCli(bounded(stub)));

    expect(receipt.observation).toBeNull();
  }, 20_000);

  it("still emits a parseable receipt when it refuses", async () => {
    stub = await startStub({ definitionUnreadable: true });
    const result = await runCli(bounded(stub));

    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout.trimStart().startsWith("{")).toBe(true);
  }, 20_000);

  it("does not read or reconcile anything on a dry run", async () => {
    stub = await startStub();
    const result = await runCli([...bounded(stub), "--dry-run"]);

    expect(stub.requests.map((r) => r.name)).not.toContain("readDefinition");
    expect(result.code).toBe(0);
  }, 20_000);
});
