#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractModels, findDbtProjects, type DbtManifest } from "./dbt.js";
import { computeProjectPrefix, canonical } from "./normalize.js";
import { joinModels, type FileIndex } from "./join.js";

interface Args {
  gitRoot: string;
  manifest: string;
  workspaceJson: string;
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a?.startsWith("--")) map.set(a.slice(2), argv[++i] ?? "");
  }
  const gitRoot = resolve(map.get("git-root") ?? process.cwd());
  const manifest = resolve(map.get("manifest") ?? "target/manifest.json");
  const workspaceJson = resolve(map.get("workspace-json") ?? ".agents/workspace.json");
  return { gitRoot, manifest, workspaceJson };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Join dbt models (manifest.json) to workspace.json behavioral intelligence,
 * normalizing dbt's project-relative paths to repo-root-relative keys (VR-640).
 * Exits non-zero if any dbt project produces zero joined rows — the silent
 * zero-row failure HAC-75 was built to surface.
 */
export function run(args: Args): number {
  const manifest = readJson<DbtManifest>(args.manifest);
  const models = extractModels(manifest);
  const workspace = readJson<{ generated?: { fileIndex?: FileIndex }; fileIndex?: FileIndex }>(
    args.workspaceJson,
  );
  const fileIndex: FileIndex = workspace.generated?.fileIndex ?? workspace.fileIndex ?? {};

  // The dbt project these models belong to is the manifest's grandparent dir
  // (<proj>/target/manifest.json -> <proj>). `projects` is the full multi-project
  // enumeration (VR-640 guard), reported so a repo with several dbt projects is
  // visibly not being treated as one.
  const projects = findDbtProjects(args.gitRoot);
  const dbtProjectDir = dirname(dirname(args.manifest));
  const prefix = computeProjectPrefix(args.gitRoot, dbtProjectDir);

  if (prefix === null) {
    console.error(`dbt project ${dbtProjectDir} is not inside git root ${args.gitRoot}`);
    return 2;
  }

  const result = joinModels(models, prefix, fileIndex);
  console.log(`git root:        ${args.gitRoot}`);
  console.log(`dbt project:     ${canonical(dbtProjectDir)}  (prefix: "${prefix}")`);
  console.log(`projects found:  ${projects.length}`);
  console.log(`join:            ${result.matched}/${result.total} models matched fileIndex`);
  for (const row of result.rows) {
    console.log(`  [${row.matched ? "hit " : "MISS"}] ${row.originalFilePath} -> ${row.normalizedKey}`);
  }
  return result.total > 0 && result.matched === 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(run(parseArgs(process.argv.slice(2))));
}
