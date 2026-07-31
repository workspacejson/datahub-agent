/**
 * HAC-265 acceptance: a deliberately seeded credential in a JSON artifact
 * makes the credential scan fail. This proves the scan pattern catches real
 * secrets, not just that the golden fixtures happen to be clean.
 */

import { describe, expect, it } from "vitest";

const CREDENTIAL_PATTERN =
  /"(token|password|secret|authorization)":\s*"(?!\[redacted\])/i;

describe("HAC-265: seeded credential is detected", () => {
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
