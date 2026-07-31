#!/usr/bin/env node
// Parity proof for the adopted DataHub/dbt adapter (adapter adoption ruling).
//
// Ported from `workspacejson/cli@c60447fc` `migration/parity-datahub-shim.mjs`,
// re-pointed at the DataHub-owned candidate: `src/adapters/workspacejson/`.
//
// The `old` side is the pre-migration package as it existed at
// `workspace-json/agents-audit@e47eb1b8` `packages/cli/`. It is fetched into a
// local cache on first run; set PARITY_OLD_SIDE to use an existing checkout.
//
// ---------------------------------------------------------------------------
// SUBSTITUTIONS — read this before trusting the count (adapter adoption ruling)
// ---------------------------------------------------------------------------
// The adapter adoption ruling ratified the target shape as an INTERNAL MODULE, not a package.
// Section 1 of the original harness asserted on `package.json` fields. An
// internal module has no manifest, so 7 of the 35 original checks are
// structurally unsatisfiable as written. Each is restated below as the
// adoption-equivalent invariant that carries the same intent, and is labeled
// `[RESTATED]` with the original check it replaces.
//
//   Sections 2-5: 28 checks, ported VERBATIM (behavioral).
//   Section 1:     7 checks, RESTATED (identity -> adoption equivalents).
//                 --
//                 35 accounted for.
//
// A second, stronger result supersedes the behavioral comparison: all five
// source files are byte-identical across the whole migration chain. Section 0
// asserts that directly.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const AGENTS_AUDIT_SHA = "e47eb1b8556c4f361db9a78190a2f36b400756e8";
const SOURCE_FILES = ["index.ts", "normalize.ts", "join.ts", "dbt.ts", "cli.ts"];

const NEW_SIDE = join(repoRoot, "src/adapters/workspacejson");
const OLD_SIDE = process.env.PARITY_OLD_SIDE
  ? resolve(process.env.PARITY_OLD_SIDE)
  : join(repoRoot, ".parity-cache", `agents-audit-${AGENTS_AUDIT_SHA.slice(0, 8)}`);

let pass = 0, fail = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`); fail += 1; failures.push(label); }
}

function equalish(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function sha256(p) { return createHash("sha256").update(readFileSync(p)).digest("hex"); }

// ---------------------------------------------------------------------------
// Provision the `old` side from the public pre-migration repository.
// ---------------------------------------------------------------------------
function provisionOldSide() {
  if (existsSync(join(OLD_SIDE, "src/index.ts")) && existsSync(join(OLD_SIDE, "package.json"))) return;
  console.log(`Provisioning parity 'old' side from workspace-json/agents-audit@${AGENTS_AUDIT_SHA.slice(0, 8)} ...`);
  mkdirSync(join(OLD_SIDE, "src"), { recursive: true });
  const fetchOne = (repoPath, destination) => {
    const r = spawnSync("gh", [
      "api", `/repos/workspace-json/agents-audit/contents/${repoPath}?ref=${AGENTS_AUDIT_SHA}`, "--jq", ".content",
    ], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error(`\nCould not fetch ${repoPath} from workspace-json/agents-audit@${AGENTS_AUDIT_SHA}.`);
      console.error("The 'old' parity side is required. Provide a checkout via PARITY_OLD_SIDE, or ensure `gh` is authenticated.");
      console.error(r.stderr?.trim() ?? "");
      process.exit(2);
    }
    writeFileSync(destination, Buffer.from(r.stdout.replace(/\s/g, ""), "base64"));
  };
  for (const f of SOURCE_FILES) fetchOne(`packages/cli/src/${f}`, join(OLD_SIDE, "src", f));
  fetchOne("packages/cli/package.json", join(OLD_SIDE, "package.json"));
}

provisionOldSide();

const oldManifest = JSON.parse(readFileSync(join(OLD_SIDE, "package.json"), "utf8"));
const oldSrc = join(OLD_SIDE, "src");

// ---------------------------------------------------------------------------
console.log("==============================================================");
console.log(" 0. SOURCE IDENTITY ACROSS THE MIGRATION CHAIN (new, adapter adoption ruling)");
console.log("==============================================================");
console.log(" Not part of the 35. A stronger claim than behavioral parity:");
console.log(" the adopted files are byte-identical to the pre-migration ones,");
console.log(" with ONE documented type-only deviation in dbt.ts.");
console.log("");

// The single permitted deviation. Upstream, `packages/datahub-adapter/
// tsconfig.json` included `types/ambient.d.ts`, which shadows `node:fs` with a
// hand-written stub; `ReturnType<typeof readdirSync>` resolved against that
// stub. This application uses real @types/node (no shim — a shim would mask
// type errors application-wide), under which the same expression selects the
// Buffer overload and fails to compile. The annotation was narrowed.
//
// Both substitutions are type-level: a `type`-only import specifier and a
// variable type annotation. TypeScript erases both, so no runtime behavior
// changes — sections 2-5 re-prove that against the old side regardless.
const TYPE_ONLY_DEVIATIONS = [
  [`import { readdirSync, type Dirent } from "node:fs";`, `import { readdirSync } from "node:fs";`],
  [`let entries: Dirent[];`, `let entries: ReturnType<typeof readdirSync>;`],
];

/** Drop `//` comment lines and blank lines so added commentary is not a diff. */
function stripCommentary(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line) && line.trim() !== "")
    .join("\n");
}

for (const f of SOURCE_FILES) {
  const oldText = readFileSync(join(oldSrc, f), "utf8");
  const newText = readFileSync(join(NEW_SIDE, f), "utf8");

  if (oldText === newText) {
    check(`byte-identical: ${f}`, sha256(join(oldSrc, f)) === sha256(join(NEW_SIDE, f)));
    continue;
  }

  // Reverse the documented type-only substitutions and re-compare. If the file
  // still differs, the deviation is NOT type-only and must not pass silently.
  let recovered = newText;
  const applied = [];
  for (const [adopted, baseline] of TYPE_ONLY_DEVIATIONS) {
    if (recovered.includes(adopted)) {
      recovered = recovered.replace(adopted, baseline);
      applied.push(adopted.trim());
    }
  }

  check(`type-only deviation (${applied.length} substitution(s)): ${f}`,
    stripCommentary(recovered) === stripCommentary(oldText),
    `after reversing the documented type-only substitutions, ${f} still differs from the baseline — the deviation is NOT type-only`);
}
// Section 0 is evidence, not acceptance. Reset so the 35 stands on its own.
const identityPass = pass, identityFail = fail;
pass = 0; fail = 0; failures.length = 0;

// ---------------------------------------------------------------------------
console.log("\n==============================================================");
console.log(" 1. ADOPTION IDENTITY AND NON-PUBLICATION  [7 RESTATED]");
console.log("==============================================================");

const appManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const newIndex = readFileSync(join(NEW_SIDE, "index.ts"), "utf8");
const newCli = readFileSync(join(NEW_SIDE, "cli.ts"), "utf8");
const newJoin = readFileSync(join(NEW_SIDE, "join.ts"), "utf8");

// [RESTATED] replaces: "renamed to an accurate identity, old name released for the neutral CLI"
// The adapter no longer has a package identity at all. The invariant that
// survives: it is an internal module of the DataHub application, and the
// application does not claim any @workspacejson/cli identity.
check("[RESTATED] adopted as an internal module — no package identity of its own",
  !existsSync(join(NEW_SIDE, "package.json")) && appManifest.name === "@workspacejson/datahub-agent",
  `NEW_SIDE/package.json exists=${existsSync(join(NEW_SIDE, "package.json"))} app=${appManifest.name}`);

// [RESTATED] replaces: "version unchanged: 0.0.1"
// No module version to compare. The surviving invariant is provenance: the
// adopted source matches the frozen baseline exactly (proven in section 0).
check("[RESTATED] provenance recorded against the frozen migration baseline",
  identityFail === 0 && existsSync(join(repoRoot, "docs/provenance.md")),
  `section 0 failures=${identityFail} provenance doc=${existsSync(join(repoRoot, "docs/provenance.md"))}`);

// [RESTATED] replaces: "STILL PRIVATE (private:true) — must never be published"
check("[RESTATED] STILL UNPUBLISHABLE — host application is private:true",
  appManifest.private === true, `private=${appManifest.private}`);

// [RESTATED] replaces: "bin surrendered `workspacejson` to the neutral CLI"
// The old package owned the `workspacejson` bin; the staged package renamed it.
// An internal module declares no bin at all, which is the strongest form of the
// same guarantee: it can never collide with the neutral CLI's command.
check("[RESTATED] declares NO bin — cannot collide with the neutral CLI command",
  appManifest.bin === undefined,
  `old bin=${JSON.stringify(oldManifest.bin)} app bin=${JSON.stringify(appManifest.bin)}`);

// [RESTATED] replaces: "exports/main/types unchanged"
// No package exports map. The equivalent surface contract is the module's own
// public surface: the same 7 functions and 5 types the package exported.
const EXPECTED_EXPORTS = [
  "toPosix", "canonical", "computeProjectPrefix", "normalizeModelPath",
  "joinModels", "extractModels", "findDbtProjects",
];
const oldIndex = readFileSync(join(oldSrc, "index.ts"), "utf8");
check("[RESTATED] public surface unchanged — same 7 functions re-exported",
  EXPECTED_EXPORTS.every((n) => newIndex.includes(n) && oldIndex.includes(n)) && newIndex === oldIndex,
  `index.ts identical=${newIndex === oldIndex}`);

// [VERBATIM intent] "declares NO generate command (it is not the producer)"
check("[RESTATED] declares NO generate command (it is not the producer)",
  !JSON.stringify(appManifest).includes("generate") && !newCli.includes("generateWorkspaceJson"),
  "the DataHub application must never become a workspace.json producer");

// [VERBATIM intent] "does not depend on agents-audit or @workspacejson/rules"
const appDeps = { ...(appManifest.dependencies ?? {}), ...(appManifest.devDependencies ?? {}) };
check("[RESTATED] does not depend on agents-audit or @workspacejson/rules",
  !("agents-audit" in appDeps) && !("@workspacejson/rules" in appDeps)
  && !newJoin.includes("agents-audit") && !newJoin.includes("@workspacejson/rules"),
  `deps=${JSON.stringify(Object.keys(appDeps))}`);

// ---------------------------------------------------------------------------
console.log("\n==============================================================");
console.log(" 2. PATH NORMALIZATION AND KEY CONSTRUCTION (old vs new)  [11 VERBATIM]");
console.log("==============================================================");

const mods = {
  old: await import(join(oldSrc, "index.ts")),
  new: await import(join(NEW_SIDE, "index.ts")),
};

const normalizeCases = [
  ["./src/models/a.sql", "src/models/a.sql"],
  ["src/models/a.sql/", "src/models/a.sql"],
  ["src/models/a.sql", "src/models/a.sql"],
  ["./a//b/", "a//b"],
];
for (const [input, expected] of normalizeCases) {
  const o = mods.old.canonical(input), n = mods.new.canonical(input);
  check(`canonical(${JSON.stringify(input)}) => ${JSON.stringify(n)}`, o === n && n === expected, `old=${o} new=${n} expected=${expected}`);
}

const prefixCases = [
  ["/repo", "/repo", ""],                       // dbt project IS the git root
  ["/repo", "/repo/analytics", "analytics"],     // nested one level
  ["/repo", "/repo/sub/warehouse", "sub/warehouse"],
  ["/repo", "/elsewhere", null],                 // escapes the git root
];
for (const [root, proj, expected] of prefixCases) {
  const o = mods.old.computeProjectPrefix(root, proj), n = mods.new.computeProjectPrefix(root, proj);
  check(`computeProjectPrefix(${root}, ${proj}) => ${JSON.stringify(n)}`, o === n && n === expected, `old=${o} new=${n} expected=${expected}`);
}

const keyCases = [
  ["", "models/customers.sql", "models/customers.sql"],
  ["analytics", "models/customers.sql", "analytics/models/customers.sql"],
  ["sub/warehouse", "./models/x.sql", "sub/warehouse/models/x.sql"],
];
for (const [prefix, original, expected] of keyCases) {
  const o = mods.old.normalizeModelPath(prefix, original), n = mods.new.normalizeModelPath(prefix, original);
  check(`normalizeModelPath(${JSON.stringify(prefix)}, ${JSON.stringify(original)}) => ${JSON.stringify(n)}`,
    o === n && n === expected, `old=${o} new=${n} expected=${expected}`);
}

// ---------------------------------------------------------------------------
console.log("\n==============================================================");
console.log(" 3. dbt PROJECT DISCOVERY AND MANIFEST EXTRACTION  [5 VERBATIM]");
console.log("==============================================================");

const repo = mkdtempSync(join(tmpdir(), "shim-parity-"));
mkdirSync(join(repo, "analytics/models"), { recursive: true });
mkdirSync(join(repo, "sub/warehouse/models"), { recursive: true });
mkdirSync(join(repo, "node_modules/decoy"), { recursive: true });
writeFileSync(join(repo, "analytics/dbt_project.yml"), "name: analytics\n");
writeFileSync(join(repo, "sub/warehouse/dbt_project.yml"), "name: warehouse\n");
writeFileSync(join(repo, "node_modules/decoy/dbt_project.yml"), "name: decoy\n"); // must be ignored

const foundOld = mods.old.findDbtProjects(repo);
const foundNew = mods.new.findDbtProjects(repo);
check("findDbtProjects discovers BOTH dbt projects (multi-project guard)",
  foundNew.length === 2 && equalish(foundOld, foundNew), `old=${JSON.stringify(foundOld)} new=${JSON.stringify(foundNew)}`);
check("findDbtProjects ignores node_modules (would otherwise inflate the count)",
  !foundNew.some((p) => p.includes("node_modules")));
check("findDbtProjects output is deterministic (sorted)",
  equalish(foundNew, [...foundNew].sort()));

const manifest = {
  nodes: {
    "model.analytics.customers": { resource_type: "model", unique_id: "model.analytics.customers", original_file_path: "models/customers.sql" },
    "model.analytics.orders":    { resource_type: "model", unique_id: "model.analytics.orders",    original_file_path: "models/orders.sql" },
    "test.analytics.not_a_model":{ resource_type: "test",  unique_id: "test.analytics.not_a_model", original_file_path: "tests/t.sql" },
    "model.analytics.nopath":    { resource_type: "model", unique_id: "model.analytics.nopath" },
  },
};
const modelsOld = mods.old.extractModels(manifest), modelsNew = mods.new.extractModels(manifest);
check("extractModels returns only resource_type=model with a path",
  modelsNew.length === 2 && equalish(modelsOld, modelsNew), `new=${JSON.stringify(modelsNew)}`);
check("extractModels tolerates an empty manifest",
  equalish(mods.old.extractModels({}), mods.new.extractModels({})) && mods.new.extractModels({}).length === 0);

// ---------------------------------------------------------------------------
console.log("\n==============================================================");
console.log(" 4. JOIN AGAINST fileIndex (the actual DataHub fix)  [4 VERBATIM]");
console.log("==============================================================");

const fileIndex = { "analytics/models/customers.sql": { fragility: 0.5 }, "analytics/models/orders.sql": { fragility: 0.1 } };

const joinedOld = mods.old.joinModels(modelsNew, "analytics", fileIndex);
const joinedNew = mods.new.joinModels(modelsNew, "analytics", fileIndex);
check("nested dbt project joins 2/2 after prefix normalization",
  joinedNew.matched === 2 && joinedNew.total === 2 && equalish(joinedOld, joinedNew));

// The regression this shim exists to prevent: WITHOUT the prefix, a nested
// project silently matches nothing.
const naiveOld = mods.old.joinModels(modelsNew, "", fileIndex);
const naiveNew = mods.new.joinModels(modelsNew, "", fileIndex);
check("PERTURBED: without the project prefix the same join collapses to 0/2",
  naiveNew.matched === 0 && naiveNew.total === 2 && equalish(naiveOld, naiveNew),
  `new matched=${naiveNew.matched}/${naiveNew.total}`);

const partial = mods.new.joinModels(modelsNew, "analytics", { "analytics/models/customers.sql": {} });
check("PERTURBED: partial fileIndex yields a partial match (1/2), not all-or-nothing",
  partial.matched === 1 && partial.total === 2);
check("join rows expose normalizedKey and matched for every model",
  joinedNew.rows.length === 2 && joinedNew.rows.every((r) => typeof r.normalizedKey === "string" && typeof r.matched === "boolean"));

// ---------------------------------------------------------------------------
console.log("\n==============================================================");
console.log(" 5. CLI RUNTIME: fileIndex shapes and zero-join exit code  [8 VERBATIM]");
console.log("==============================================================");

// The original harness spawned `node <side>/dist/cli.js`. Neither side is built
// here — both run from TypeScript source under the tsx loader. Same entry
// point, same argv, same exit codes; no behavior is mediated by a build step.
const CLI_ENTRY = { old: join(oldSrc, "cli.ts"), new: join(NEW_SIDE, "cli.ts") };
const TSX_ARGS = ["--import", "tsx"];

function spawnCli(side, argv) {
  return spawnSync(process.execPath, [...TSX_ARGS, CLI_ENTRY[side], ...argv], {
    encoding: "utf8",
    cwd: repoRoot,
  });
}

function runCli(side, { workspace, manifestNodes, projectDir = "analytics" }) {
  const dir = mkdtempSync(join(tmpdir(), `shim-cli-${side}-`));
  mkdirSync(join(dir, projectDir, "target"), { recursive: true });
  writeFileSync(join(dir, projectDir, "dbt_project.yml"), "name: analytics\n");
  writeFileSync(join(dir, projectDir, "target/manifest.json"), JSON.stringify({ nodes: manifestNodes }));
  mkdirSync(join(dir, ".agents"), { recursive: true });
  writeFileSync(join(dir, ".agents/workspace.json"), JSON.stringify(workspace));
  const result = spawnCli(side, [
    "--git-root", dir,
    "--manifest", join(dir, projectDir, "target/manifest.json"),
    "--workspace-json", join(dir, ".agents/workspace.json"),
  ]);
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const nodes = {
  "model.a.customers": { resource_type: "model", unique_id: "model.a.customers", original_file_path: "models/customers.sql" },
};
const nestedGenerated = { generated: { fileIndex: { "analytics/models/customers.sql": {} } } };
const legacyTopLevel  = { fileIndex: { "analytics/models/customers.sql": {} } };
const noMatch         = { generated: { fileIndex: { "totally/other/path.sql": {} } } };

for (const [label, workspace, expectStatus, expectPattern] of [
  ["generated.fileIndex joins and exits 0", nestedGenerated, 0, /1\/1 models matched/],
  ["legacy top-level fileIndex fallback still supported", legacyTopLevel, 0, /1\/1 models matched/],
  ["ZERO-JOIN exits non-zero (the silent failure HAC-75 surfaces)", noMatch, 1, /0\/1 models matched/],
]) {
  for (const side of ["old", "new"]) {
    const r = runCli(side, { workspace, manifestNodes: nodes });
    check(`[${side}] ${label}`, r.status === expectStatus && expectPattern.test(r.out),
      `status=${r.status} (expected ${expectStatus})\n          ${r.out.split("\n").slice(0, 3).join("\n          ")}`);
  }
}

// dbt project outside the git root must refuse rather than emit bogus keys
for (const side of ["old", "new"]) {
  const dir = mkdtempSync(join(tmpdir(), `shim-outside-${side}-`));
  const outside = mkdtempSync(join(tmpdir(), `shim-elsewhere-${side}-`));
  mkdirSync(join(outside, "target"), { recursive: true });
  writeFileSync(join(outside, "target/manifest.json"), JSON.stringify({ nodes }));
  mkdirSync(join(dir, ".agents"), { recursive: true });
  writeFileSync(join(dir, ".agents/workspace.json"), JSON.stringify(nestedGenerated));
  const r = spawnCli(side, [
    "--git-root", dir, "--manifest", join(outside, "target/manifest.json"),
    "--workspace-json", join(dir, ".agents/workspace.json"),
  ]);
  check(`[${side}] PERTURBED: dbt project outside git root refuses with exit 2`,
    r.status === 2 && /is not inside git root/.test(`${r.stdout}${r.stderr}`),
    `status=${r.status}`);
  rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true });
}

rmSync(repo, { recursive: true, force: true });

console.log("\n==============================================================");
console.log(` SOURCE IDENTITY (section 0, evidence): ${identityPass} passed, ${identityFail} failed`);
console.log(` RESULT: ${pass} passed, ${fail} failed  (total ${pass + fail})`);
console.log(`   of which  7 RESTATED (section 1) and ${pass + fail - 7} VERBATIM (sections 2-5)`);
if (fail) console.log(` FAILED: ${failures.join(", ")}`);
console.log("==============================================================");
process.exit(fail || identityFail ? 1 : 0);
