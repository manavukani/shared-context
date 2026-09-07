import { describe, it } from "node:test";
import { MarkdownCodec } from "../../src/sync/markdown.js";
import { expect } from "../expect.js";

describe("MarkdownCodec", () => {
  it("round-trips discoveries", () => {
    const sections = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "PKCE required",
        body: "Public clients must use PKCE.",
        createdAt: Date.parse("2026-09-07T00:00:00Z"),
        source: "claude-code",
      },
    ];
    const md = MarkdownCodec.memories("discovery", sections);
    expect(md).toContain("PKCE required");
    const parsed = MarkdownCodec.parseMemories(md);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(sections[0]?.id);
    expect(parsed[0]?.body).toBe(sections[0]?.body);
    expect(parsed[0]?.source).toBe("claude-code");
  });

  it("round-trips standup items", () => {
    const md = MarkdownCodec.standup([{ projectId: "issuer-ui", sentence: "Shipping OAuth refresh." }]);
    expect(MarkdownCodec.parseStandup(md)).toEqual([
      { projectId: "issuer-ui", sentence: "Shipping OAuth refresh." },
    ]);
  });

  it("parses current work without the heading", () => {
    expect(MarkdownCodec.parseCurrentWork(MarkdownCodec.currentWork("Build the token page."))).toBe(
      "Build the token page.",
    );
  });
});
