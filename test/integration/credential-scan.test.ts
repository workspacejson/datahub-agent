/**
 * HAC-265 acceptance: the credential-scan regex catches seeded credentials.
 *
 * These are pattern-level tests proving the regex used in
 * `test/integration/golden-fixture.test.ts` detects real secrets and passes
 * redacted values. The actual file-level scan of committed golden fixtures
 * lives in that test file. SECURITY.md scopes the scan to golden-fixture
 * writeback blocks only.
 */

import { describe, expect, it } from "vitest";

const CREDENTIAL_PATTERN =
  /"(token|password|secret|authorization)":\s*"(?!\[redacted\])/i;

describe("HAC-265: credential-scan regex catches seeded credentials", () => {
  it("fails when a token field contains a real value", () => {
    const seeded = JSON.stringify({
      writeback: {
        attempts: [{ mutation: "upsertDataset", variables: { token: "sk-abc123" } }],
      },
    });
    expect(seeded).toMatch(CREDENTIAL_PATTERN);
  });

  it("fails when a password field contains a real value", () => {
    const seeded = JSON.stringify({
      writeback: { attempts: [{ variables: { password: "hunter2" } }] },
    });
    expect(seeded).toMatch(CREDENTIAL_PATTERN);
  });

  it("does not fail when a token field is redacted", () => {
    const clean = JSON.stringify({
      writeback: { attempts: [{ variables: { token: "[redacted]" } }] },
    });
    expect(clean).not.toMatch(CREDENTIAL_PATTERN);
  });

  it("does not fail when no credential fields are present", () => {
    const clean = JSON.stringify({
      writeback: { attempts: [{ variables: { urn: "urn:li:dataset:(x,PROD)" } }] },
    });
    expect(clean).not.toMatch(CREDENTIAL_PATTERN);
  });
});
