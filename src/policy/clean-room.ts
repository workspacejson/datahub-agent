/**
 * The clean-room import rule, made executable.
 *
 * `docs/clean-room.md` states the rule and names dependency manifests as the
 * source of truth for enforcing it: every `workspacejson`-origin dependency must
 * resolve to a published version, never a local, link, or git reference into a
 * private checkout.
 *
 * That claim was previously enforced by code review alone. This is the same
 * claim as a function, so a path reference added to `package.json` fails a
 * command rather than depending on a reviewer noticing it.
 *
 * The audit is offline and structural by design. It reads what the manifests
 * declare and what the lockfile resolved; it does not reach the network, so it
 * gives the same answer in CI, on a plane, and in a judge's checkout.
 */

/** Packages whose origin the rule governs — the standard's org and its private producers. */
const CONTROLLED = /^(@workspacejson\/|workspacejson$|agents-audit$|@marcelle-labs\/|marcelle-labs$|vreko)/i;

/**
 * Specifiers that point at something other than a published registry version.
 * A tarball URL is included: it is not a private checkout, but it is not a
 * published version either, and the rule is about resolving to the registry.
 */
const NON_REGISTRY_SPEC =
  /^(file:|link:|portal:|workspace:|git\+|git:|github:|https?:|\.{0,2}\/|~\/|[a-zA-Z]:\\)/;

/** An exact version — no range operators, no tags. The rule requires exact pins. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface CleanRoomViolation {
  /** Where the problem is, as a reader would cite it. */
  where: string;
  /** What is wrong, stated so it stands alone in CI output. */
  problem: string;
}

export interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface LockManifest {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string; resolved?: string; link?: boolean }>;
}

export const isControlledPackage = (name: string): boolean => CONTROLLED.test(name);

/**
 * Audit the manifests against the rule.
 *
 * Returns violations rather than throwing, so the caller can print all of them
 * at once. A reviewer fixing one path reference should see the other three in
 * the same run, not discover them one command at a time.
 */
export function auditCleanRoom(pkg: PackageManifest, lock: LockManifest): CleanRoomViolation[] {
  const violations: CleanRoomViolation[] = [];

  const fields = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const;

  for (const field of fields) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      const controlled = isControlledPackage(name);

      if (NON_REGISTRY_SPEC.test(spec)) {
        violations.push({
          where: `package.json ${field}.${name}`,
          problem: controlled
            ? `"${spec}" is a local, git, or URL reference into a controlled package. The rule permits published registry versions only.`
            : `"${spec}" is a local, git, or URL reference. The application must build from its own lockfile with no path references.`,
        });
        continue;
      }

      // Ranges are tolerable for third-party tooling; for a controlled package
      // the recorded provenance is a specific version, and a range would let it
      // drift out from under the record without a diff.
      if (controlled && !EXACT_VERSION.test(spec)) {
        violations.push({
          where: `package.json ${field}.${name}`,
          problem: `"${spec}" is not an exact version. A controlled dependency must be pinned so provenance cannot drift silently.`,
        });
      }
    }
  }

  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === "") continue; // the root project itself

    if (entry.link) {
      violations.push({
        where: `package-lock.json ${path}`,
        problem: "resolves to a linked local directory rather than a published package.",
      });
      continue;
    }

    // A registry package always records where it came from. An entry with no
    // `resolved` is either the root or something resolved outside the registry.
    if (entry.resolved === undefined) {
      violations.push({
        where: `package-lock.json ${path}`,
        problem: "has no resolved source, so it cannot be shown to come from the registry.",
      });
      continue;
    }

    if (!entry.resolved.startsWith("https://registry.npmjs.org/")) {
      violations.push({
        where: `package-lock.json ${path}`,
        problem: `resolves to ${entry.resolved}, which is not the public npm registry.`,
      });
    }
  }

  return violations;
}

/** The controlled dependencies and their pins, for the record the audit prints. */
export function controlledDependencies(pkg: PackageManifest): Array<{ name: string; spec: string }> {
  const seen = new Map<string, string>();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (isControlledPackage(name)) seen.set(name, spec);
    }
  }
  return [...seen].map(([name, spec]) => ({ name, spec })).sort((a, b) => a.name.localeCompare(b.name));
}
