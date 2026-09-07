import { describe, it } from "node:test";
import { SecretRedactor } from "../../src/secrets.js";
import { expect } from "../expect.js";

describe("SecretRedactor", () => {
  it("redacts API keys and tokens", () => {
    const input = [
      "openai sk-abcdefghijklmnopqrstuvwxyz123456",
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      "Authorization: Bearer supersecrettokenvalue",
      "api_key=abcdEFGH12345678",
      "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----",
    ].join("\n");
    const out = SecretRedactor.redact(input);
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(out).not.toContain("supersecrettokenvalue");
    expect(out).not.toContain("abcdEFGH12345678");
    expect(out).not.toContain("BEGIN PRIVATE KEY");
    expect(out).toContain("[REDACTED]");
  });

  it("leaves ordinary notes alone", () => {
    const note = "The issuer-ui login form uses session cookies.";
    expect(SecretRedactor.redact(note)).toBe(note);
  });
});
