import { describe, it } from "node:test";
import { ContentHash } from "../../src/hash.js";
import { expect } from "../expect.js";

describe("ContentHash", () => {
  it("is stable across whitespace and case", () => {
    const a = ContentHash.of("discovery", "OAuth", "Use PKCE  for  public clients");
    const b = ContentHash.of("discovery", "oauth", "use pkce for public clients");
    expect(a).toBe(b);
  });

  it("changes when the body changes", () => {
    const a = ContentHash.of("discovery", "OAuth", "Use PKCE");
    const b = ContentHash.of("discovery", "OAuth", "Do not use PKCE");
    expect(a).not.toBe(b);
  });
});
