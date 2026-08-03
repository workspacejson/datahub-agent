#!/usr/bin/env node
/**
 * Render the HAC-150 aggregate as a human-readable receipt.
 *
 * Every rate is printed as `count/denominator`, never as a percentage alone. A
 * percentage hides the experiment's size, and the size is the thing HAC-150
 * exists to establish: "90%" reads the same whether it came from ten runs or
 * from one that was rounded.
 *
 * The summary does not decide whether the result supports the cockpit's causal
 * sentence. It prints what was measured and states the denominator, and the
 * wording decision is made by a human reading it against the claim.
 *
 * usage: node scripts/summarise-hac-150.mjs --dir evaluation/hac-150
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const dir = flag("dir", "evaluation/hac-150");
const root = resolve(dir);

let manifest;
let aggregate;
try {
  manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  aggregate = JSON.parse(readFileSync(join(root, "aggregate.json"), "utf8"));
} catch (error) {
  console.error(`refused: could not read manifest.json and aggregate.json in ${dir} (${error.message})`);
  process.exit(2);
}

const rate = (measured) => `${measured.count}/${measured.denominator}`;
const m = aggregate.measures;
const s = aggregate.stability;

/**
 * The one-line finding, stated at the strength the numbers support.
 *
 * Three bands, because the honest sentence differs by result and picking it by
 * hand is how a mixed result gets written up as a clean one. A unanimous split
 * may be named as a difference; a partial one is reported with both counts and
 * no causal verb; no separation retains the pre-result wording verbatim.
 */
function finding() {
  const joined = m.exactRevisionOnlyInJoined;
  const observed = aggregate.pairsObserved;
  if (observed === 0) return "No pair produced a usable comparison. The evaluation establishes nothing; retain the pre-result wording.";
  if (joined.count === joined.denominator) {
    return `Across ${joined.denominator} controlled paired runs on the pinned corpus, the joined context supplied the exact revision in ${rate(joined)} runs and DataHub-only supplied it in 0/${joined.denominator}.`;
  }
  if (joined.count === 0) {
    return `No stable difference appeared: the joined context supplied the exact revision in ${rate(joined)} runs. Retain the pre-result wording.`;
  }
  return `Mixed result: the joined context supplied the exact revision in ${rate(joined)} runs. State the mixed finding with its denominator and do not assert a general causal claim.`;
}

const lines = [];
lines.push("# HAC-150 — repeated DataHub-only vs joined-context paired evaluation");
lines.push("");
lines.push("Ten identical tasks run under two conditions, holding task, model, prompt, decoding settings, repository revision and DataHub snapshot constant. The context envelope is the only varying input.");
lines.push("");
lines.push("## Finding");
lines.push("");
lines.push(finding());
lines.push("");
lines.push("## Experiment");
lines.push("");
lines.push("| Field | Value |");
lines.push("| --- | --- |");
lines.push(`| Pairs requested | ${manifest.experiment.pairsRequested} |`);
lines.push(`| Task | \`${manifest.experiment.taskId}\` |`);
lines.push(`| Model | \`${manifest.experiment.model}\` |`);
lines.push(`| Decoding settings | \`${JSON.stringify(manifest.experiment.settings)}\` |`);
lines.push(`| Prompt digest | \`${manifest.experiment.promptDigest}\` |`);
lines.push(`| Settings digest | \`${manifest.experiment.settingsDigest}\` |`);
lines.push(`| Event digest | \`${manifest.subject.eventDigest}\` |`);
lines.push(`| Exact source | \`${manifest.subject.exactSource}\` |`);
lines.push(`| Pinned revision | \`${manifest.subject.exactRevision}\` |`);
lines.push(`| Request timeout | ${manifest.experiment.timeoutMs} ms |`);
lines.push("");
lines.push("## Outcomes");
lines.push("");
lines.push("| Outcome | Pairs |");
lines.push("| --- | --- |");
lines.push(`| Observed (both conditions parsed) | ${aggregate.pairsObserved}/${aggregate.pairsRequested} |`);
lines.push(`| Partial (one condition failed) | ${aggregate.pairsPartial}/${aggregate.pairsRequested} |`);
lines.push(`| Failed (both conditions failed) | ${aggregate.pairsFailed}/${aggregate.pairsRequested} |`);
lines.push("");
lines.push("Denominators are the pairs **requested**. A failed run is reported as a failure, never excluded from the denominator.");
lines.push("");
lines.push("## The six measures");
lines.push("");
lines.push("| Measure | Result |");
lines.push("| --- | --- |");
lines.push(`| Exact source only in joined | ${rate(m.exactSourceOnlyInJoined)} |`);
lines.push(`| Exact revision only in joined | ${rate(m.exactRevisionOnlyInJoined)} |`);
lines.push(`| Refusal removed by join | ${rate(m.refusalRemovedByJoin)} |`);
lines.push(`| Step sequencing changed | ${rate(m.sequencingChanged)} |`);
lines.push(`| Writeback choice changed | ${rate(m.writebackChoiceChanged)} |`);
lines.push(`| Any file added by join | ${rate(m.anyFileAddedByJoin)} |`);
lines.push(`| Any file removed by join | ${rate(m.anyFileRemovedByJoin)} |`);
lines.push("");
lines.push("## Run-to-run stability, per condition");
lines.push("");
lines.push("| Condition | Observed | Distinct step sequences | Distinct step counts | Refusal present |");
lines.push("| --- | --- | --- | --- | --- |");
lines.push(`| DataHub-only | ${rate(s.datahubOnly.observed)} | ${s.datahubOnly.distinctSequences} | ${s.datahubOnly.distinctStepCounts} | ${rate(s.datahubOnly.refusalPresent)} |`);
lines.push(`| Joined | ${rate(s.joined.observed)} | ${s.joined.distinctSequences} | ${s.joined.distinctStepCounts} | ${rate(s.joined.refusalPresent)} |`);
lines.push("");
lines.push("A distinct-sequence count above 1 means the condition did not produce an identical plan every time. That is the nondeterminism this evaluation exists to characterise.");
lines.push("");
lines.push("## Within-pair invocation order");
lines.push("");
// A manifest without the scheme is one produced before order was controlled.
// Printing `undefined` there would render a missing control as a present one,
// so the absence is stated in the words a reader needs.
lines.push(
  manifest.experiment.invocationOrderScheme
    ? `Order was counterbalanced by pair index: \`${manifest.experiment.invocationOrderScheme}\`. A fixed order could not separate a condition effect from a position effect.`
    : "**This manifest records no invocation-order scheme**, so the within-pair order was not controlled and a position effect cannot be separated from a condition effect. Treat the split below as descriptive only.",
);
lines.push("");
lines.push("| Lead condition | Pairs assigned | Exact revision only in joined |");
lines.push("| --- | --- | --- |");
lines.push(`| DataHub-only first | ${aggregate.orderEffect.datahubOnlyFirst.assigned} | ${rate(aggregate.orderEffect.datahubOnlyFirst.exactRevisionOnlyInJoined)} |`);
lines.push(`| Joined first | ${aggregate.orderEffect.joinedFirst.assigned} | ${rate(aggregate.orderEffect.joinedFirst.exactRevisionOnlyInJoined)} |`);
lines.push("");
lines.push("Denominators are the pairs **assigned** to each arm, fixed before any invocation. A sharp difference between arms means position mattered and the headline sentence must say so.");
lines.push("");
lines.push("## Failures");
lines.push("");
if (aggregate.failures.length === 0) {
  lines.push("None. Every invocation returned a parsable plan.");
} else {
  lines.push("| Pair | Condition | Kind | Detail |");
  lines.push("| --- | --- | --- | --- |");
  for (const f of aggregate.failures) {
    lines.push(`| \`${f.pairId}\` | ${f.condition} | ${f.failure.kind} | ${String(f.failure.detail).replace(/\|/g, "\\|")} |`);
  }
}
lines.push("");
lines.push("## Artifacts");
lines.push("");
lines.push("| Artifact | File | Digest |");
lines.push("| --- | --- | --- |");
lines.push(`| Manifest | \`manifest.json\` | (this file's subject) |`);
lines.push(`| Pair records | \`${manifest.artifacts.pairs.file}\` | \`${manifest.artifacts.pairs.digest}\` |`);
lines.push(`| Aggregate | \`${manifest.artifacts.aggregate.file}\` | \`${manifest.artifacts.aggregate.digest}\` |`);
lines.push(`| Raw model output | \`raw/\` | ${manifest.artifacts.raw.length} file(s), digested in \`manifest.json\` |`);
lines.push("");
lines.push("## Reproduce");
lines.push("");
lines.push("```");
lines.push(manifest.reproduce);
lines.push(`node scripts/summarise-hac-150.mjs --dir ${dir}`);
lines.push("```");
lines.push("");
lines.push("The API key is read from the environment named in `manifest.json` (`experiment.apiKeyEnv`) and is never written to any artifact.");
lines.push("");

const out = join(root, "README.md");
writeFileSync(out, `${lines.join("\n")}`);
console.error(`written ${dir}/README.md`);
console.error(`  ${finding()}`);
