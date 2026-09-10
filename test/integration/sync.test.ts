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
    expect(hits.some((hit) => hit.title === "From DB")).toBe(false);
    expect(readFileSync(file, "utf8")).toContain("From markdown");
    expect(readFileSync(file, "utf8")).not.toContain("From DB");
  });

  it("does not crash sync when markdown repeats an existing content hash", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    const saved = await MemoryService.saveDiscovery(session, {
      projectId: "issuer-ui",
      title: "PKCE required",
      body: "Public clients must use PKCE.",
      source: "cli",
    });
    const file = session.paths.discoveriesFile("issuer-ui");
    writeFileSync(
      file,
      `# Discoveries\n\n## PKCE required\n\n<!-- id: ${saved.memory.id} | source: cli -->\n\nPublic clients must use PKCE.\n\n## PKCE required\n\n<!-- id: 33333333-3333-4333-8333-333333333333 | source: markdown -->\n\nPublic clients must use PKCE.\n`,
      "utf8",
    );
    await SyncEngine.importThenExport(session);
    const rows = session.sqlite.prepare("SELECT id, title FROM memories WHERE project_id = ?").all("issuer-ui") as {
      id: string;
      title: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(saved.memory.id);
  });

  it("redacts secrets when importing markdown", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    await MemoryService.updateCurrentWork(session, {
      projectId: "issuer-ui",
      body: "Safe work note.",
    });
    writeFileSync(
      session.paths.discoveriesFile("issuer-ui"),
      `# Discoveries\n\n## Token leak\n\n<!-- id: 44444444-4444-4444-8444-444444444444 | source: markdown -->\n\nkey is sk-abcdefghijklmnopqrstuvwxyz123456 do not share\n`,
      "utf8",
    );
    writeFileSync(
      session.paths.currentWorkFile("issuer-ui"),
      `# Current work\n\ntoken ghp_abcdefghijklmnopqrstuvwxyz1234567890\n`,
      "utf8",
    );
    writeFileSync(
      session.paths.standupFile,
      `# Stand-up\n\n- **issuer-ui**: Rotate sk-abcdefghijklmnopqrstuvwxyz123456 tonight.\n`,
      "utf8",
    );
    await SyncEngine.importThenExport(session);
    const memory = session.sqlite.prepare("SELECT body FROM memories WHERE id = ?").get(
      "44444444-4444-4444-8444-444444444444",
    ) as { body: string };
    const work = session.sqlite.prepare("SELECT body FROM current_work WHERE project_id = ?").get("issuer-ui") as {
      body: string;
    };
    const standup = session.sqlite.prepare("SELECT sentence FROM standup_items WHERE project_id = ?").get(
      "issuer-ui",
    ) as { sentence: string };
    expect(memory.body).toContain("[REDACTED]");
    expect(memory.body).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(work.body).toContain("[REDACTED]");
    expect(work.body).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(standup.sentence).toContain("[REDACTED]");
    expect(standup.sentence).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });

  it("lets the DB win when both sides changed", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    await MemoryService.updateCurrentWork(session, {
      projectId: "issuer-ui",
      body: "Original work.",
    });
    const file = session.paths.currentWorkFile("issuer-ui");
    session.sqlite
      .prepare("UPDATE current_work SET body = ? WHERE project_id = ?")
      .run("Newer from DB, concurrent.", "issuer-ui");
    writeFileSync(file, "# Current work\n\nDISK edit, concurrent.\n", "utf8");
    await SyncEngine.importThenExport(session);
    expect(readFileSync(file, "utf8")).toContain("Newer from DB, concurrent.");
    expect(readFileSync(file, "utf8")).not.toContain("DISK edit, concurrent.");
  });

  it("removes memories that disappear from markdown when the file wins", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    const first = await MemoryService.saveDiscovery(session, {
      projectId: "issuer-ui",
      title: "Keep me",
      body: "This section stays.",
      source: "cli",
    });
    const second = await MemoryService.saveDiscovery(session, {
      projectId: "issuer-ui",
      title: "Drop me",
      body: "This section is removed on disk.",
      source: "cli",
    });
    const file = session.paths.discoveriesFile("issuer-ui");
    writeFileSync(
      file,
      `# Discoveries\n\n## Keep me\n\n<!-- id: ${first.memory.id} | source: cli -->\n\nThis section stays.\n`,
      "utf8",
    );
    await SyncEngine.importThenExport(session);
    const rows = session.sqlite.prepare("SELECT id FROM memories WHERE project_id = ?").all("issuer-ui") as {
      id: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.memory.id);
    expect(rows.some((row) => row.id === second.memory.id)).toBe(false);
  });
});
