#!/usr/bin/env node
/**
 * HAC-150 repeated paired evaluation harness.
 *
 * Runs N paired invocations under one frozen configuration and archives what
 * the model actually returned. It deliberately does NOT use `runPairedPlan`:
 * that function fails closed so a judge bundle cannot be invalid, which makes
 * it unusable as an instrument. A run it throws on is exactly the run this
 * experiment needs to record, because a non-conforming outcome is the evidence
 * about nondeterminism that the whole issue asks for.
 *
 * Nothing here throws on model content. Transport and parse failures become
 * recorded outcomes with their raw bytes retained, and the denominator stays at
 * the number of pairs requested.
 *
 * The API key is read from the environment, never written to any artifact and
 * never printed. The manifest records the base URL and model, which are
 * configuration, not credentials.
 *
 * usage:
 *   node --import tsx scripts/run-hac-150-evaluation.mjs \
 *     --event evaluation/hac-152/live-qwen-judge-run-bundle.json --from-bundle \
 *     --task-id add-quality-check --prompt "..." --model qwen-plus \
 *     --runs 10 --out-dir evaluation/hac-150
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const has = (name) => argv.includes(`--${name}`);

const eventFile = flag("event");
const fromBundle = has("from-bundle");
const taskId = flag("task-id");
const prompt = flag("prompt");
const model = flag("model", process.env.QWEN_MODEL ?? process.env.OPENAI_MODEL ?? null);
const baseUrl = flag("base-url", process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");
const apiKeyEnv = flag("api-key-env", "OPENAI_API_KEY");
const settingsText = flag("settings", '{"temperature":0}');
const runs = Number(flag("runs", "10"));
const outDir = flag("out-dir", "evaluation/hac-150");
const timeoutMs = Number(flag("timeout-ms", "120000"));

if (!eventFile || !taskId || !prompt || !model || !Number.isInteger(runs) || runs < 1) {
  console.error(
    "usage: node --import tsx scripts/run-hac-150-evaluation.mjs --event FILE [--from-bundle] --task-id ID --prompt TEXT --model ID [--runs 10] [--out-dir DIR] [--settings JSON] [--base-url URL] [--api-key-env NAME] [--timeout-ms 120000]",
  );
  process.exit(2);
}
const apiKey = process.env[apiKeyEnv];
if (!apiKey) {
  console.error(`refused: ${apiKeyEnv} is absent; provide it through your environment (its value is never read from a file or printed).`);
  process.exit(2);
}
let settings;
try { settings = JSON.parse(settingsText); } catch { console.error("--settings must be a JSON object"); process.exit(2); }
if (!settings || Array.isArray(settings) || typeof settings !== "object") { console.error("--settings must be a JSON object"); process.exit(2); }

const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const load = async (specifier) =>
  import(resolve(specifier)).catch(async () => {
    const api = await import("tsx/esm/api");
    api.register();
    return import(resolve(specifier));
  });

const { parsePlanResponse, buildPairRecord, aggregatePairs, conditionContexts, invocationOrderFor, PAIRED_EVALUATION_VERSION } =
  await load("src/integration/paired-evaluation.ts");
const { digestEvent } = await load("src/integration/plan-comparison.ts");

const raw = JSON.parse(readFileSync(resolve(eventFile), "utf8"));
// A judge-run bundle carries the event under `.event`; a bare event is itself.
// Accepting both means the evaluation runs against exactly the artifact that
// produced the shipped exemplar, rather than a re-derived copy of it.
const event = fromBundle ? raw.event : raw;
if (!event?.code || !event?.provenance) {
  console.error("refused: --event did not resolve to a change impact event (pass --from-bundle for a judge run bundle)");
  process.exit(2);
}

const exactSource = event.code.repositoryRelativePath;
const exactRevision = event.provenance.corpus?.commit;
if (!exactSource || !exactRevision) {
  console.error("refused: the event states no exact source or no pinned corpus revision, so the joined condition has nothing to supply.");
  process.exit(2);
}

const system = `You are planning one dbt change. Return JSON only: {"steps":[{"id":"short-stable-id","action":"imperative action"}]}. Do not claim a writeback succeeded. Use only facts supplied in CONTEXT. In datahub-only mode explicitly refuse the unknown repository-relative source location; do not guess it. In joined mode use the exact repository-relative source and pinned revision supplied in CONTEXT.`;

const conditionRequirement = (mode, context) =>
  mode === "joined"
    ? `JOINED OUTPUT REQUIREMENT: include the following literals verbatim in one or more step actions: repository-relative source ${JSON.stringify(context.code.repositoryRelativePath)}; pinned revision ${JSON.stringify(context.provenance.corpus.commit)}.`
    : "DATAHUB-ONLY OUTPUT REQUIREMENT: explicitly say that the repository-relative source location is unknown and refuse to guess or edit it.";

/**
 * One invocation. Returns `{ ok, content }` or `{ ok: false, transport }`.
 *
 * Transport failure is returned rather than thrown so the caller can record it
 * against the pair. An exception here would abort the experiment mid-run and
 * leave a partial archive whose denominator nobody could reconstruct.
 */
async function invokeOnce(mode, context) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        ...settings,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `TASK (identical across conditions):\n${prompt}\n\nMODE: ${mode}\n${conditionRequirement(mode, context)}\n\nCONTEXT (the only varying input):\n${JSON.stringify(context)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, transport: `model request failed with HTTP ${response.status}` };
    const body = await response.json().catch(() => null);
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { ok: false, transport: "model response contained no message content" };
    return { ok: true, content };
  } catch (error) {
    return { ok: false, transport: `${error?.name ?? "Error"}: ${error?.message ?? String(error)}` };
  }
}

/** Parse the returned text, or record it verbatim as unparsable. */
function outcomeFor(mode, result) {
  if (!result.ok) return { state: "failed", failure: { kind: "transport", detail: result.transport } };
  let parsed;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return { state: "failed", failure: { kind: "unparsable", detail: "model response was not JSON", raw: result.content.slice(0, 2000) } };
  }
  return parsePlanResponse(mode, parsed);
}

const { datahubOnly: datahubOnlyContext, joined: joinedContext } = conditionContexts(event);
const outRoot = resolve(outDir);
const rawDir = join(outRoot, "raw");
mkdirSync(rawDir, { recursive: true });

const run = { taskId, promptDigest: digest(prompt), model, settingsDigest: digest(JSON.stringify(settings)) };
const records = [];
const rawArtifacts = [];

for (let index = 0; index < runs; index += 1) {
  const pairId = `${taskId}-pair-${String(index).padStart(2, "0")}`;
  const order = invocationOrderFor(index);
  // Sequential, not parallel. Ten concurrent pairs would share rate-limit
  // pressure, and a throttled run would be recorded as model instability when
  // it is harness instability.
  //
  // Counterbalanced within the pair: even pairs lead with DataHub-only, odd
  // pairs lead with joined. A fixed order could not separate a condition effect
  // from a position effect, and the order each pair used is recorded on the
  // pair so the split is checkable rather than trusted.
  const results = {};
  for (const mode of order) {
    results[mode] = await invokeOnce(mode, mode === "joined" ? joinedContext : datahubOnlyContext);
  }
  const datahubResult = results["datahub-only"];
  const joinedResult = results.joined;

  for (const [condition, result] of [["datahub-only", datahubResult], ["joined", joinedResult]]) {
    const name = `${pairId}.${condition}.txt`;
    const body = result.ok ? result.content : `TRANSPORT FAILURE: ${result.transport}`;
    writeFileSync(join(rawDir, name), `${body}\n`);
    rawArtifacts.push({ pairId, condition, file: `raw/${name}`, digest: digest(body) });
  }

  const record = buildPairRecord(
    pairId,
    index,
    outcomeFor("datahub-only", datahubResult),
    outcomeFor("joined", joinedResult),
    exactSource,
    exactRevision,
    order,
  );
  records.push(record);
  console.error(`  pair ${index + 1}/${runs} ${pairId}: ${record.outcome}`);
}

const aggregate = aggregatePairs(records, run, runs);
const pairsFile = join(outRoot, "pairs.json");
const aggregateFile = join(outRoot, "aggregate.json");
const manifestFile = join(outRoot, "manifest.json");

const pairsBody = `${JSON.stringify({ evaluationVersion: PAIRED_EVALUATION_VERSION, run, pairs: records }, null, 2)}\n`;
const aggregateBody = `${JSON.stringify(aggregate, null, 2)}\n`;
writeFileSync(pairsFile, pairsBody);
writeFileSync(aggregateFile, aggregateBody);

const manifest = {
  evaluationVersion: PAIRED_EVALUATION_VERSION,
  issue: "HAC-150",
  // Frozen configuration. Every field here must be identical across all pairs
  // or the comparison is confounded; they are recorded so that is checkable
  // rather than asserted.
  experiment: {
    pairsRequested: runs,
    taskId,
    prompt,
    promptDigest: run.promptDigest,
    model,
    settings,
    settingsDigest: run.settingsDigest,
    baseUrl,
    timeoutMs,
    apiKeyEnv,
    // Within-pair invocation order is counterbalanced by pair index rather than
    // fixed, so a position effect cannot hide inside the condition difference.
    // The scheme is deterministic, so the manifest alone reproduces it.
    invocationOrderScheme: "counterbalanced-by-index: even pairs lead datahub-only, odd pairs lead joined",
    invocationOrderByPair: Array.from({ length: runs }, (_, i) => ({ index: i, order: invocationOrderFor(i) })),
  },
  subject: {
    eventFile,
    fromBundle,
    eventDigest: digestEvent(event),
    exactSource,
    exactRevision,
    corpusRepository: event.provenance.corpus?.repository ?? null,
  },
  artifacts: {
    pairs: { file: "pairs.json", digest: digest(pairsBody) },
    aggregate: { file: "aggregate.json", digest: digest(aggregateBody) },
    raw: rawArtifacts,
  },
  reproduce:
    `node --import tsx scripts/run-hac-150-evaluation.mjs --event ${eventFile}${fromBundle ? " --from-bundle" : ""} ` +
    `--task-id ${taskId} --prompt <see experiment.prompt> --model ${model} --runs ${runs} --out-dir ${outDir} ` +
    `--settings '${JSON.stringify(settings)}' --base-url ${baseUrl}`,
};
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

console.error(
  `\nwritten ${outDir}/: ${aggregate.pairsObserved}/${runs} observed, ${aggregate.pairsPartial} partial, ${aggregate.pairsFailed} failed, ${aggregate.failures.length} recorded failure(s)`,
);
console.error(`  exact revision only in joined: ${aggregate.measures.exactRevisionOnlyInJoined.count}/${runs}`);
console.error(`  next: node scripts/summarise-hac-150.mjs --dir ${outDir}`);
