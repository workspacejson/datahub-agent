#!/usr/bin/env node
/**
 * Forge screen for measurement-corpus candidates (HAC-213 / HAC-143 follow-on).
 *
 * Selection criterion per the META-195 thread, 2026-07-10:
 *
 *   "Demo-repo constraint dissolves. Merge-commit preservation is no longer
 *    required. Select the corpus on lineage quality and patch_path cardinality
 *    instead."
 *
 * Pre-squash history survives on the forge via refs/pull/<n>/head, so a local
 * `git log` is the WRONG instrument for judging whether fix-follow signal
 * exists. This screens the forge instead.
 *
 * Per candidate it measures:
 *   - license / archived / stars            (usability as a pinned public corpus)
 *   - dbt_project.yml at root + model count (is it actually dbt-shaped)
 *   - merged PR count                       (corpus size)
 *   - multi-commit merged PR ratio          (recoverable fix-follow sequence)
 *   - median commits per merged PR
 *
 * One GraphQL call per repo for PR data; the rest is cheap REST.
 *
 * Usage:
 *   node scripts/screen-corpus-candidates.mjs [--sample 50] [owner/repo ...]
 */

import { execFileSync } from "node:child_process";

const CANDIDATES = [
  // incumbent — the frozen join/demo corpus (HAC-143)
  "dbt-labs/jaffle_shop_duckdb",
  // real dbt pipeline projects
  "dcaribou/transfermarkt-datasets",
  "g0v/tw_campaign_finance",
  "SarahDelgadoMartin/curso_data_engineering",
  "bcodell/activity_schema_demo",
  // mature dbt packages — dbt-shaped, real multi-year engineering history
  "dbt-labs/dbt-utils",
  "dbt-labs/dbt-audit-helper",
  "calogica/dbt-expectations",
  "brooklyn-data/dbt_artifacts",
  "Datavault-UK/automate-dv",
  "elementary-data/dbt-data-reliability",
  "dbt-labs/dbt-project-evaluator",
];

const args = process.argv.slice(2);
const sampleIdx = args.indexOf("--sample");
const SAMPLE = sampleIdx === -1 ? 50 : Number(args[sampleIdx + 1]);
const repos = args.filter((a) => a.includes("/"));
const targets = repos.length ? repos : CANDIDATES;

function gh(cmdArgs) {
  try {
    return execFileSync("gh", cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

function meta(repo) {
  const out = gh(["api", `/repos/${repo}`, "--jq",
    '{license:(.license.spdx_id // "NONE"),archived:.archived,stars:.stargazers_count,branch:.default_branch,pushed:.pushed_at[0:10]}']);
  return out ? JSON.parse(out) : null;
}

/** Is it dbt-shaped, and how many models? Uses the git tree — one call. */
function dbtShape(repo, branch) {
  const out = gh(["api", `/repos/${repo}/git/trees/${branch}?recursive=1`, "--jq",
    '[.tree[]|select(.type=="blob")|.path]']);
  if (!out) return { dbtProject: false, models: 0, rootProject: false };
  let paths;
  try { paths = JSON.parse(out); } catch { return { dbtProject: false, models: 0, rootProject: false }; }
  const projects = paths.filter((p) => p.endsWith("dbt_project.yml"));
  const models = paths.filter((p) => /(^|\/)models\/.*\.(sql|py)$/.test(p)).length;
  return {
    dbtProject: projects.length > 0,
    rootProject: projects.includes("dbt_project.yml"),
    projectCount: projects.length,
    models,
  };
}

/** Merged PRs with per-PR commit counts — one GraphQL call. */
function prShape(repo, sample) {
  const [owner, name] = repo.split("/");
  const q = `query($owner:String!,$name:String!,$n:Int!){
    repository(owner:$owner,name:$name){
      pullRequests(states:MERGED,last:$n){
        totalCount
        nodes{ number commits{totalCount} changedFiles }
      }
    }
  }`;
  const out = gh(["api", "graphql", "-f", `query=${q}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `n=${sample}`]);
  if (!out) return null;
  let d;
  try { d = JSON.parse(out).data.repository.pullRequests; } catch { return null; }
  const nodes = d.nodes ?? [];
  if (!nodes.length) return { merged: d.totalCount ?? 0, sampled: 0, multi: 0, ratio: 0, median: 0 };
  const counts = nodes.map((n) => n.commits.totalCount).sort((a, b) => a - b);
  const multi = counts.filter((c) => c > 1).length;
  return {
    merged: d.totalCount,
    sampled: nodes.length,
    multi,
    ratio: multi / nodes.length,
    median: counts[Math.floor(counts.length / 2)],
  };
}

const OSI = new Set(["Apache-2.0", "MIT", "BSD-3-Clause", "BSD-2-Clause", "CC0-1.0", "GPL-3.0", "MPL-2.0"]);

const rows = [];
for (const repo of targets) {
  process.stderr.write(`screening ${repo} ... `);
  const m = meta(repo);
  if (!m) { process.stderr.write("NOT FOUND\n"); continue; }
  const shape = dbtShape(repo, m.branch);
  const pr = prShape(repo, SAMPLE);
  rows.push({ repo, ...m, ...shape, ...(pr ?? {}) });
  process.stderr.write("ok\n");
}

// Score: corpus size x recoverable-sequence density, gated on usability.
for (const r of rows) {
  const usable = OSI.has(r.license) && !r.archived && r.dbtProject;
  // recoverable multi-commit PRs is the quantity that actually matters
  r.recoverable = Math.round((r.merged ?? 0) * (r.ratio ?? 0));
  r.usable = usable;
}
rows.sort((a, b) => (b.usable - a.usable) || (b.recoverable - a.recoverable));

const pad = (s, n) => String(s).padEnd(n);
console.log("");
console.log(`${pad("repo", 42)}${pad("license", 13)}${pad("models", 7)}${pad("mergedPR", 9)}${pad("multi%", 8)}${pad("recover", 8)}usable`);
console.log("-".repeat(95));
for (const r of rows) {
  console.log(
    pad(r.repo, 42) +
    pad(r.license, 13) +
    pad(r.models ?? "-", 7) +
    pad(r.merged ?? "-", 9) +
    pad(r.ratio != null ? `${Math.round(r.ratio * 100)}%` : "-", 8) +
    pad(r.recoverable ?? "-", 8) +
    (r.usable ? "yes" : "NO"),
  );
}
console.log("");
console.log("recover = mergedPR x multi%  — estimated PRs carrying a pre-squash sequence");
console.log("usable  = OSI license AND not archived AND dbt_project.yml present");
console.log(`sample  = last ${SAMPLE} merged PRs per repo`);
