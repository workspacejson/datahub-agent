/**
 * The clean-room rule is a claim this repository makes to judges about what is
 * genuinely new work here versus reused plumbing. These tests exercise the
 * audit against poisoned manifests, because a checker that cannot fail is worth
 * no more than the sentence it replaced.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  auditCleanRoom,
  controlledDependencies,
  isControlledPackage,
  type LockManifest,
  type PackageManifest,
} from "../../src/policy/clean-room.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (name: string) => JSON.parse(readFileSync(join(repoRoot, name), "utf8"));

const cleanPkg = (): PackageManifest => ({
  name: "@workspacejson/datahub-agent",
  dependencies: { "@workspacejson/spec": "0.4.4" },
  devDependencies: { "@workspacejson/cli": "0.5.0", typescript: "^5.4.0" },
});

const cleanLock = (): LockManifest => ({
  lockfileVersion: 3,
  packages: {
    "": { version: "0.0.1" },
    "node_modules/@workspacejson/spec": {
      version: "0.4.4",
      resolved: "https://registry.npmjs.org/@workspacejson/spec/-/spec-0.4.4.tgz",
    },
  },
});

describe("isControlledPackage", () => {
  it.each(["@workspacejson/spec", "@workspacejson/cli", "agents-audit", "vreko", "vreko-core"])(
    "governs %s",
    (name) => expect(isControlledPackage(name)).toBe(true),
  );

  it.each(["typescript", "vitest", "@types/node", "tsx"])("leaves %s alone", (name) =>
    expect(isControlledPackage(name)).toBe(false),
  );
});

describe("auditCleanRoom", () => {
  it("passes a manifest that resolves everything from the registry", () => {
    expect(auditCleanRoom(cleanPkg(), cleanLock())).toEqual([]);
  });

  it.each([
    ["file:", "file:../../workspacejson/cli"],
    ["link:", "link:../cli"],
    ["workspace:", "workspace:*"],
    ["portal:", "portal:../cli"],
    ["a git URL", "git+https://github.com/workspacejson/cli.git"],
    ["a github shorthand", "github:workspacejson/cli"],
    ["a relative path", "../cli"],
    ["an absolute path", "/Users/someone/cli"],
    ["a home-relative path", "~/cli"],
  ])("rejects %s reference to a controlled package", (_label, spec) => {
    const pkg = cleanPkg();
    pkg.dependencies!["@workspacejson/cli"] = spec;
    const problems = auditCleanRoom(pkg, cleanLock());
    expect(problems).toHaveLength(1);
    expect(problems[0]?.where).toBe("package.json dependencies.@workspacejson/cli");
    expect(problems[0]?.problem).toMatch(/published registry versions only/);
  });

  it("rejects a path reference to any package, controlled or not", () => {
    // The rule is not only about workspacejson: the application must build from
    // its own lockfile with no local references at all.
    const pkg = cleanPkg();
    pkg.devDependencies!["some-tool"] = "file:../some-tool";
    expect(auditCleanRoom(pkg, cleanLock())[0]?.problem).toMatch(/no path references/);
  });

  it("rejects a path reference in optionalDependencies", () => {
    const pkg = cleanPkg();
    pkg.optionalDependencies = { "@workspacejson/spec": "file:../spec" };
    const problems = auditCleanRoom(pkg, cleanLock());
    expect(problems).toHaveLength(1);
    expect(problems[0]?.where).toBe("package.json optionalDependencies.@workspacejson/spec");
  });

  it("rejects a path reference in peerDependencies", () => {
    const pkg = cleanPkg();
    pkg.peerDependencies = { "@workspacejson/cli": "link:../cli" };
    const problems = auditCleanRoom(pkg, cleanLock());
    expect(problems).toHaveLength(1);
    expect(problems[0]?.where).toBe("package.json peerDependencies.@workspacejson/cli");
  });

  it("rejects a range on a controlled package, which would let provenance drift", () => {
    // provenance.md records an exact version. A caret would let the resolved
    // code change without the record changing.
    const pkg = cleanPkg();
    pkg.dependencies!["@workspacejson/spec"] = "^0.4.4";
    expect(auditCleanRoom(pkg, cleanLock())[0]?.problem).toMatch(/not an exact version/);
  });

  it("rejects a tarball URL for a controlled package", () => {
    const pkg = cleanPkg();
    pkg.dependencies!["@workspacejson/spec"] = "https://example.com/spec-0.4.4.tgz";
    const problems = auditCleanRoom(pkg, cleanLock());
    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem).toMatch(/published registry versions only/);
  });

  it("permits a range on a third-party devDependency", () => {
    const pkg = cleanPkg();
    pkg.devDependencies!.typescript = "^5.4.0";
    expect(auditCleanRoom(pkg, cleanLock())).toEqual([]);
  });

  it("rejects a lockfile entry linked to a local directory", () => {
    const lock = cleanLock();
    lock.packages!["node_modules/@workspacejson/cli"] = { link: true };
    expect(auditCleanRoom(cleanPkg(), lock)[0]?.problem).toMatch(/linked local directory/);
  });

  it("rejects a lockfile entry resolved outside the public registry", () => {
    const lock = cleanLock();
    lock.packages!["node_modules/@workspacejson/cli"] = {
      version: "0.5.0",
      resolved: "https://npm.internal.example.com/@workspacejson/cli/-/cli-0.5.0.tgz",
    };
    expect(auditCleanRoom(cleanPkg(), lock)[0]?.problem).toMatch(/not the public npm registry/);
  });

  it("rejects a lockfile entry with no resolved source that is not a declared workspace", () => {
    const lock = cleanLock();
    lock.packages!["node_modules/mystery-pkg"] = { version: "1.0.0" };
    const problems = auditCleanRoom(cleanPkg(), lock);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.where).toBe("package-lock.json node_modules/mystery-pkg");
    expect(problems[0]?.problem).toMatch(/no resolved source/);
  });

  it("ignores the lockfile's root entry, which has no resolved source by design", () => {
    expect(auditCleanRoom(cleanPkg(), cleanLock())).toEqual([]);
  });

  it("permits a declared native workspace and exactly its npm-generated link", () => {
    const pkg: PackageManifest = { ...cleanPkg(), workspaces: ["apps/*"] };
    const lock = cleanLock();
    lock.packages!["apps/cockpit"] = { version: "0.0.1" };
    lock.packages!["node_modules/@workspacejson/cockpit"] = { link: true, resolved: "apps/cockpit" };
    expect(auditCleanRoom(pkg, lock)).toEqual([]);
  });

  it("rejects a link that only resembles a workspace", () => {
    const pkg: PackageManifest = { ...cleanPkg(), workspaces: ["apps/*"] };
    const lock = cleanLock();
    lock.packages!["node_modules/escaped"] = { link: true, resolved: "outside/escaped" };
    expect(auditCleanRoom(pkg, lock)[0]?.problem).toMatch(/linked local directory/);
  });

  it("reports every violation at once rather than stopping at the first", () => {
    // A reviewer fixing one path reference should see the rest in the same run.
    // Exact count, not >= 2, so a regression that stops reporting all of them
    // is caught.
    const pkg = cleanPkg();
    pkg.dependencies!["@workspacejson/spec"] = "file:../spec";
    pkg.devDependencies!["@workspacejson/cli"] = "link:../cli";
    expect(auditCleanRoom(pkg, cleanLock())).toHaveLength(2);
  });
});

describe("this repository", () => {
  it("satisfies its own clean-room rule", () => {
    // The check runs as `npm run check:clean-room`. Asserting it here too means
    // a violation fails the ordinary test run, not only a separate command.
    expect(auditCleanRoom(read("package.json"), read("package-lock.json"))).toEqual([]);
  });

  it("declares its controlled dependencies at the exact versions provenance records", () => {
    expect(controlledDependencies(read("package.json"))).toEqual([
      { name: "@workspacejson/cli", spec: "0.5.0" },
      { name: "@workspacejson/spec", spec: "0.4.4" },
    ]);
  });

  it("returns an empty list when no controlled packages are declared", () => {
    expect(controlledDependencies({ name: "plain-app", dependencies: { express: "4.18.0" } })).toEqual([]);
  });
});
