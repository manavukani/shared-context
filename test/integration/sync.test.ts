import { afterEach, describe, it } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { MemoryService } from "../../src/memory/service.js";
import type { ContextSession } from "../../src/session.js";
import { SyncEngine } from "../../src/sync/engine.js";
import { expect } from "../expect.js";
import { openSession } from "../helpers.js";

describe("markdown sync", () => {
  let session: ContextSession;

  afterEach(() => {
    session?.close();
  });

  it("exports memories to markdown and imports file-only edits", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    await MemoryService.saveDiscovery(session, {
      projectId: "issuer-ui",
      title: "From DB",
      body: "Stored in SQLite first.",
      source: "cli",
    });
    const file = session.paths.discoveriesFile("issuer-ui");
    expect(readFileSync(file, "utf8")).toContain("From DB");

    writeFileSync(
      file,
      `# Discoveries\n\n## From markdown\n\n<!-- id: 22222222-2222-4222-8222-222222222222 | source: markdown -->\n\nEdited on disk.\n`,
      "utf8",
    );
    await SyncEngine.importThenExport(session);
    const hits = await MemoryService.search(session, { query: "Edited" });
    expect(hits.some((hit) => hit.title === "From markdown")).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("From DB");
  });

  it("lets the DB win when both sides changed", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    await MemoryService.updateCurrentWork(session, {
      projectId: "issuer-ui",
      body: "Original work.",
    });
    const file = session.paths.currentWorkFile("issuer-ui");
    writeFileSync(file, "# Current work\n\nDisk edit that should lose.\n", "utf8");
    session.sqlite.prepare("UPDATE sync_meta SET db_hash = 'stale-db' WHERE rel_path = ?").run(
      "projects/issuer-ui/current-work.md",
    );
    await SyncEngine.importThenExport(session);
    expect(readFileSync(file, "utf8")).toContain("Original work.");
    expect(readFileSync(file, "utf8")).not.toContain("Disk edit that should lose");
  });
});
