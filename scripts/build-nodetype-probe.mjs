#!/usr/bin/env node
/**
 * Rebuild the HAC-162 node-type probe and re-run the coverage check.
 *
 * The frozen proof corpus (HAC-143) contains only models, seeds and tests. It
 * has no snapshots, no Python models and no sources, so it cannot answer
 * whether dbt populates `original_file_path` for those kinds. HAC-162 forbids
 * assuming SQL-model behavior generalizes, so this builds a minimal dbt project
 * that instantiates exactly the missing three and reports their coverage.
 *
 * This is NOT a second proof corpus. It makes no measurement claims.
 *
 * Usage:
 *   node scripts/build-nodetype-probe.mjs [--dbt <path-to-dbt>] [--out <dir>]
 *
 * Requires a dbt with the duckdb adapter. If --dbt is omitted, `dbt` from PATH
 * is used.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const dbt = arg("dbt", "dbt");
const outDir = resolve(arg("out", join(tmpdir(), "workspacejson-nodetype-probe")));

const FILES = {
  "dbt_project.yml": `name: nodetype_probe
version: "1.0.0"
profile: nodetype_probe
model-paths: ["models"]
seed-paths: ["seeds"]
snapshot-paths: ["snapshots"]
`,
  "profiles.yml": `nodetype_probe:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: probe.duckdb
`,
  "seeds/raw_thing.csv": "id,name\n1,alpha\n",
  "models/sources.yml": `version: 2
sources:
  - name: probe_src
    schema: main
    tables:
      - name: raw_thing
`,
  "models/sql_model.sql": "select * from {{ ref('raw_thing') }}\n",
  "models/py_model.py": `def model(dbt, session):
    dbt.config(materialized="table")
    return dbt.ref("sql_model")
`,
  "snapshots/snap_thing.sql": `{% snapshot snap_thing %}
{{ config(target_schema='main', unique_key='id', strategy='check', check_cols=['name']) }}
select * from {{ ref('sql_model') }}
{% endsnapshot %}
`,
};

rmSync(outDir, { recursive: true, force: true });
for (const [rel, body] of Object.entries(FILES)) {
  const path = join(outDir, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

const parse = spawnSync(dbt, ["parse"], {
  cwd: outDir,
  encoding: "utf8",
  env: { ...process.env, DBT_PROFILES_DIR: outDir },
});
if (parse.status !== 0) {
  console.error(`dbt parse failed (exit ${parse.status}). Is '${dbt}' a dbt with the duckdb adapter?`);
  console.error(parse.stdout ?? "");
  console.error(parse.stderr ?? "");
  process.exit(2);
}

const manifestPath = join(outDir, "target/manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`dbt parse reported success but produced no manifest at ${manifestPath}`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

console.log(`probe:  ${outDir}`);
console.log(`dbt:    ${manifest.metadata?.dbt_version} / ${manifest.metadata?.adapter_type}`);
console.log("");
console.log("resource_type\tlanguage\toriginal_file_path");
const rows = [];
for (const node of Object.values(manifest.nodes ?? {})) {
  rows.push([node.resource_type, node.language ?? "-", node.original_file_path ?? "NULL"]);
}
for (const node of Object.values(manifest.sources ?? {})) {
  rows.push([node.resource_type, "-", node.original_file_path ?? "NULL"]);
}
for (const r of rows.sort((a, b) => a.join().localeCompare(b.join()))) console.log(r.join("\t"));

const nulls = rows.filter(([, , p]) => p === "NULL");
console.log("");
if (nulls.length === 0) {
  console.log(`CLEAN — ${rows.length} node(s)/source(s), 0 null original_file_path`);
} else {
  console.log(`GAPS — ${nulls.length} of ${rows.length} have a null original_file_path:`);
  for (const [t] of nulls) console.log(`  ${t}`);
}

const required = ["snapshot", "source"];
const seen = new Set(rows.map(([t]) => t));
const pythonModels = rows.filter(([t, l]) => t === "model" && l === "python").length;
const missing = [...required.filter((t) => !seen.has(t)), ...(pythonModels ? [] : ["model(python)"])];
if (missing.length) {
  console.error(`\nProbe did not instantiate: ${missing.join(", ")} — it cannot discharge HAC-162 as built.`);
  process.exit(1);
}
process.exit(nulls.length === 0 ? 0 : 1);
