/**
 * Derive degraded-state fixtures from a real run, rather than authoring them.
 *
 * HAC-145 forbids hand-edited demo JSON, and the ban earns its keep here. A
 * hand-written `accepted-not-observed` receipt would be a plausible string
 * arrangement asserting that a mutation was acknowledged and never confirmed —
 * which is precisely the claim the state exists to make checkable. Deriving it
 * from `evaluation/hac-152/live-event-with-writeback.json` means the identity,
 * provenance, lineage, accounting and mutation attempts are all things that
 * actually happened against a real GMS; only the named degradation is applied.
 *
 * Each fixture ships a sidecar recording its base artifact, its base digest, and
 * the exact transformation applied. The sidecar pattern is the one already used
 * beside `workspace.json`: fixture provenance travels next to the artifact
 * rather than inside it, because the contract rejects undeclared keys and an
 * event carrying "how I was derived" would no longer be shaped like an event.
 *
 *   node scripts/derive-state-fixtures.mjs
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "evaluation/hac-152/live-event-with-writeback.json";
const OUT = "test/fixtures/golden/states";

const basePath = join(root, BASE);
const baseRaw = readFileSync(basePath);
const baseDigest = createHash("sha256").update(baseRaw).digest("hex");
const base = JSON.parse(baseRaw.toString("utf8"));

/** Deep clone, so a transformation cannot reach back into the base. */
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * What the base run's after-state read actually did, and what that does not
 * establish.
 *
 * A degraded fixture that inverts an observation should say what the real
 * observation was, or a reader has no way to tell a modelled failure from a
 * measured one. `accepted-not-observed` sets `status: timed-out`; the run it
 * comes from settled on the first poll in 10ms.
 *
 * That is read-your-writes converging immediately through the production
 * after-state path, on the pinned stack, and it matters because the alternative
 * would have been expensive: had the after-state read traversed an eventually
 * consistent tier, this fixture's premise would be wrong, the evidence would
 * need regenerating, and the adapter and copy would follow. It does not.
 *
 * **The read tier itself is not established, and is recorded as unknown rather
 * than inferred.** Ten milliseconds is consistent with a primary read and also
 * consistent with a replica that happened to be current. One observation cannot
 * separate them, and a fast answer is not evidence of a strong consistency
 * guarantee. Stating the tier as unknown is the honest disclosure; asserting
 * primary from a latency number would be exactly the kind of claim this
 * repository refuses elsewhere.
 *
 * Derived from the base rather than transcribed, so it cannot drift from it.
 */
const observation = base.writeback?.observation ?? null;
const BASE_OBSERVATION = {
  status: observation?.status ?? null,
  polls: observation?.polls ?? null,
  elapsedMs: observation?.elapsedMs ?? null,
  timeoutMs: observation?.timeoutMs ?? null,
  bothStatesRead: base.writeback?.bothStatesRead ?? null,
  beforeRead: base.writeback?.before?.read ?? null,
  afterRead: base.writeback?.after?.read ?? null,
  readTier: "unknown",
  readTierNote:
    "The after-state read settled on the first poll, which shows read-your-writes converging " +
    "immediately on this stack but does not establish which storage tier served it. A replica " +
    "that happened to be current answers identically. Recorded as unknown rather than inferred " +
    "from latency; no primary-read option has been identified on the pinned stack.",
  surface: "GraphQL dataset(urn:) — institutionalMemory, structuredProperties",
  instrumentNote:
    "The client behind this read checks the GraphQL top-level `errors` array before HTTP status " +
    "and maps a failed read to an unreadable state rather than to nulls, so an unreachable " +
    "instance cannot be recorded here as an empty one. Audited 2026-07-29 across all nine " +
    "GraphQL clients in this repository.",
};

const STATES = [
  {
    name: "accepted-not-observed",
    /** HAC-217 ship/defer ledger, "Mutation accepted; intended state not observed". */
    state: "Mutation accepted; intended state not observed",
    why:
      "HAC-217 rules this a mandatory terminal state: acceptance is not success, and the " +
      "distinction is central to the trust surface. HAC-226 binds it into Receipts.",
    transformation: [
      "writeback.observation.status: settled -> timed-out",
      "writeback.observation.polls: 1 -> 12, elapsedMs raised to the full timeoutMs",
      "writeback.succeeded: true -> false",
      "writeback.after.evidenceTier: set to the before-state value, so the after-state reads cleanly and shows the pre-mutation answer",
    ],
    note:
      "The after-state read still succeeds. That is the point: `read: ok` and a stale answer " +
      "are two facts, and a surface collapsing them would lose the distinction exactly where " +
      "it matters. Every mutation attempt is left untouched and still succeeded, so the " +
      "mutation is genuinely accepted and genuinely unconfirmed.",
    apply(event) {
      const writeback = event.writeback;
      writeback.observation = {
        ...writeback.observation,
        status: "timed-out",
        polls: 12,
        elapsedMs: writeback.observation.timeoutMs,
        lastError: null,
      };
      writeback.succeeded = false;
      // The after-state read completed and returned what was there before the
      // mutation. Not a failed read — a successful read of a stale answer.
      writeback.after = { ...writeback.after, evidenceTier: writeback.before.evidenceTier, read: "ok", readError: null };
      return event;
    },
  },
];

mkdirSync(join(root, OUT), { recursive: true });

for (const spec of STATES) {
  const event = spec.apply(clone(base));
  const body = `${JSON.stringify(event, null, 2)}\n`;
  const file = `change-impact-event.${spec.name}.json`;
  writeFileSync(join(root, OUT, file), body);

  const sidecar = {
    fixture: file,
    state: spec.state,
    why: spec.why,
    derivedFrom: BASE,
    derivedFromSha256: baseDigest,
    generated_by: "scripts/derive-state-fixtures.mjs",
    command: "node scripts/derive-state-fixtures.mjs",
    transformation: spec.transformation,
    note: spec.note,
    // Read from the base rather than written down beside it, so it cannot drift
    // from the run it describes. See BASE_OBSERVATION.
    baseObservation: BASE_OBSERVATION,
    fixtureSha256: createHash("sha256").update(body).digest("hex"),
  };
  writeFileSync(join(root, OUT, `${file.replace(/\.json$/, "")}.provenance.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
  console.log(`${file}  <- ${BASE} (${spec.transformation.length} transformation(s))`);
}
