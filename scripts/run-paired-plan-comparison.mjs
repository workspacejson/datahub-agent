#!/usr/bin/env node
/** Run HAC-152's two controlled OpenAI-compatible (for example, Qwen) model invocations. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const eventFile = flag("event");
const outFile = flag("out");
const taskId = flag("task-id");
const prompt = flag("prompt");
const model = flag("model", process.env.QWEN_MODEL ?? process.env.OPENAI_MODEL ?? null);
const baseUrl = flag("base-url", process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");
const apiKeyEnv = flag("api-key-env", "OPENAI_API_KEY");
const settingsText = flag("settings", '{"temperature":0}');
if (!eventFile || !outFile || !taskId || !prompt || !model) {
  console.error("usage: doppler run --project dev_week_26_openai --config <config> -- node --import tsx scripts/run-paired-plan-comparison.mjs --event EVENT.json --out BUNDLE.json --task-id ID --prompt TEXT --model QWEN_MODEL_ID [--settings JSON]");
  process.exit(2);
}
const apiKey = process.env[apiKeyEnv];
if (!apiKey) {
  console.error(`refused: ${apiKeyEnv} is absent; provide it through Doppler (its value is never read from a file or printed).`);
  process.exit(2);
}
let settings;
try { settings = JSON.parse(settingsText); } catch { console.error("--settings must be a JSON object"); process.exit(2); }
if (!settings || Array.isArray(settings) || typeof settings !== "object") { console.error("--settings must be a JSON object"); process.exit(2); }
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const load = async (specifier) => import(resolve(specifier)).catch(async () => { const api = await import("tsx/esm/api"); api.register(); return import(resolve(specifier)); });
const { runPairedPlan } = await load("src/integration/paired-plan-runner.ts");
const { validateBundle } = await load("src/integration/plan-comparison.ts");
const event = JSON.parse(readFileSync(resolve(eventFile), "utf8"));

const system = `You are planning one dbt change. Return JSON only: {"steps":[{"id":"short-stable-id","action":"imperative action"}]}. Do not claim a writeback succeeded. Use only facts supplied in CONTEXT. In datahub-only mode explicitly refuse the unknown repository-relative source location; do not guess it. In joined mode use the exact repository-relative source and pinned revision supplied in CONTEXT.`;
async function invoke({ mode, taskPrompt, context, run }) {
  const conditionRequirement = mode === "joined"
    ? `JOINED OUTPUT REQUIREMENT: include the following literals verbatim in one or more step actions: repository-relative source ${JSON.stringify(context.code.repositoryRelativePath)}; pinned revision ${JSON.stringify(context.provenance.corpus.commit)}.`
    : "DATAHUB-ONLY OUTPUT REQUIREMENT: explicitly say that the repository-relative source location is unknown and refuse to guess or edit it.";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: run.model, ...settings, response_format: { type: "json_object" }, messages: [
      { role: "system", content: system },
      { role: "user", content: `TASK (identical across conditions):\n${taskPrompt}\n\nMODE: ${mode}\n${conditionRequirement}\n\nCONTEXT (the only varying input):\n${JSON.stringify(context)}` },
    ] }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`model request failed with HTTP ${response.status}`);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("model response contained no message content");
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error("model response was not JSON"); }
  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.some((s) => !s || typeof s.id !== "string" || typeof s.action !== "string")) throw new Error("model JSON must contain steps with string id and action");
  return parsed;
}
const run = { taskId, promptDigest: digest(prompt), model, settingsDigest: digest(JSON.stringify(settings)) };
const bundle = await runPairedPlan({ event, run, taskPrompt: prompt, invoke });
const problems = validateBundle(bundle);
if (problems.length) { console.error(`refused JudgeRunBundle:\n  ${problems.join("\n  ")}`); process.exit(1); }
writeFileSync(resolve(outFile), `${JSON.stringify(bundle, null, 2)}\n`);
console.error(`written ${outFile}: ${bundle.comparison.deltas.length} typed deltas; validated external-model paired run`);
