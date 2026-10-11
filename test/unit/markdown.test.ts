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

  it("keeps in-body ## headings inside a single section", () => {
    const sections = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Auth notes",
        body: "Step one.\n\n## Sub heading\n\nStep two.",
        source: "cli",
      },
    ];
    const parsed = MarkdownCodec.parseMemories(MarkdownCodec.memories("discovery", sections));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(sections[0]?.id);
    expect(parsed[0]?.title).toBe("Auth notes");
    expect(parsed[0]?.body).toBe("Step one.\n\n## Sub heading\n\nStep two.");
  });

  it("does not treat ## plus a non-metadata comment as a new section", () => {
    const md = `# Discoveries\n\n## Auth notes\n\n<!-- id: 11111111-1111-4111-8111-111111111111 | source: cli -->\n\nStep one.\n\n## Sub heading\n\n<!-- todo: follow up -->\n\nStep two.\n`;
    const parsed = MarkdownCodec.parseMemories(md);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.body).toContain("## Sub heading");
    expect(parsed[0]?.body).toContain("<!-- todo: follow up -->");
  });

  it("does not strip HTML comments that belong to the body", () => {
    const sections = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Notes",
        body: "Keep this <!-- todo: follow up --> in the note.",
        source: "cli",
      },
    ];
    const parsed = MarkdownCodec.parseMemories(MarkdownCodec.memories("discovery", sections));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.body).toBe("Keep this <!-- todo: follow up --> in the note.");
  });

  it("round-trips standup items", () => {
    const md = MarkdownCodec.standup([{ projectId: "issuer-ui", sentence: "Shipping OAuth refresh." }]);
    expect(MarkdownCodec.parseStandup(md)).toEqual([{ projectId: "issuer-ui", sentence: "Shipping OAuth refresh." }]);
  });

  it("parses current work without the heading", () => {
    expect(MarkdownCodec.parseCurrentWork(MarkdownCodec.currentWork("Build the token page."))).toBe(
      "Build the token page.",
    );
  });
});
