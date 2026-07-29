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
    fixtureSha256: createHash("sha256").update(body).digest("hex"),
  };
  writeFileSync(join(root, OUT, `${file.replace(/\.json$/, "")}.provenance.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
  console.log(`${file}  <- ${BASE} (${spec.transformation.length} transformation(s))`);
}
