import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { currentWork, memories, projects, standupItems, syncMeta } from "../db/schema.js";
import { ContentHash } from "../hash.js";
import { Logger } from "../logging/logger.js";
import { SecretRedactor } from "../secrets.js";
import type { ContextSession } from "../session.js";
import { MarkdownCodec, type MemoryKind } from "./markdown.js";

export class SyncEngine {
  static async exportAll(session: ContextSession): Promise<void> {
    const projectRows = session.db.select().from(projects).all();
    for (const project of projectRows) {
      mkdirSync(session.paths.projectDir(project.id), { recursive: true });
      await SyncEngine.exportCurrentWork(session, project.id);
      await SyncEngine.exportMemories(session, project.id, "discovery");
      await SyncEngine.exportMemories(session, project.id, "decision");
    }
    await SyncEngine.exportStandup(session);
  }

  static async importThenExport(session: ContextSession): Promise<{ imported: string[]; exported: string[] }> {
    const imported: string[] = [];
    const projectRows = session.db.select().from(projects).all();
    for (const project of projectRows) {
      mkdirSync(session.paths.projectDir(project.id), { recursive: true });
      for (const [rel, abs, importer] of SyncEngine.projectFiles(session, project.id)) {
        if (await SyncEngine.maybeImport(session, rel, abs, importer)) {
          imported.push(rel);
        }
      }
    }
    if (await SyncEngine.maybeImport(session, "standup.md", session.paths.standupFile, (md) => {
      SyncEngine.applyStandupMarkdown(session, md);
    })) {
      imported.push("standup.md");
    }
    await SyncEngine.exportAll(session);
    session.client.rebuildFts();
    Logger.info(session, "sync", `imported ${imported.length} file(s)`);
    return { imported, exported: ["markdown"] };
  }

  static async exportCurrentWork(session: ContextSession, projectId: string): Promise<void> {
    const row = session.db.select().from(currentWork).where(eq(currentWork.projectId, projectId)).get();
    const markdown = MarkdownCodec.currentWork(row?.body ?? "");
    SyncEngine.writeTracked(session, `projects/${projectId}/current-work.md`, session.paths.currentWorkFile(projectId), markdown);
  }

  static async exportMemories(session: ContextSession, projectId: string, kind: MemoryKind): Promise<void> {
    const rows = session.db
      .select()
      .from(memories)
      .where(eq(memories.projectId, projectId))
      .all()
      .filter((row) => row.kind === kind)
      .sort((a, b) => b.createdAt - a.createdAt);
    const markdown = MarkdownCodec.memories(
      kind,
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        createdAt: row.createdAt,
        source: row.source ?? undefined,
      })),
    );
    const rel = `projects/${projectId}/${kind === "discovery" ? "discoveries" : "decisions"}.md`;
    const abs = kind === "discovery" ? session.paths.discoveriesFile(projectId) : session.paths.decisionsFile(projectId);
    SyncEngine.writeTracked(session, rel, abs, markdown);
  }

  static async exportStandup(session: ContextSession): Promise<void> {
    const items = session.db.select().from(standupItems).all().sort((a, b) => a.projectId.localeCompare(b.projectId));
    const markdown = MarkdownCodec.standup(items);
    SyncEngine.writeTracked(session, "standup.md", session.paths.standupFile, markdown);
  }

  private static projectFiles(
    session: ContextSession,
    projectId: string,
  ): [string, string, (markdown: string) => void][] {
    return [
      [
        `projects/${projectId}/current-work.md`,
        session.paths.currentWorkFile(projectId),
        (md) => {
          const body = SecretRedactor.redact(MarkdownCodec.parseCurrentWork(md));
          const now = Date.now();
          session.db
            .insert(currentWork)
            .values({ projectId, body, source: "markdown", updatedAt: now })
            .onConflictDoUpdate({
              target: currentWork.projectId,
              set: { body, source: "markdown", updatedAt: now },
            })
            .run();
        },
      ],
      [
        `projects/${projectId}/discoveries.md`,
        session.paths.discoveriesFile(projectId),
        (md) => SyncEngine.applyMemoryMarkdown(session, projectId, "discovery", md),
      ],
      [
        `projects/${projectId}/decisions.md`,
        session.paths.decisionsFile(projectId),
        (md) => SyncEngine.applyMemoryMarkdown(session, projectId, "decision", md),
      ],
    ];
  }

  private static applyMemoryMarkdown(
    session: ContextSession,
    projectId: string,
    kind: MemoryKind,
    markdown: string,
  ): void {
    const sections = MarkdownCodec.parseMemories(markdown);
    const now = Date.now();
    for (const section of sections) {
      const title = SecretRedactor.redact(section.title);
      const body = SecretRedactor.redact(section.body);
      const existing = session.db.select().from(memories).where(eq(memories.id, section.id)).get();
      const hash = ContentHash.of(kind, title, body);
      const hashOwner = session.sqlite
        .prepare(
          "SELECT id FROM memories WHERE project_id = ? AND kind = ? AND content_hash = ? LIMIT 1",
        )
        .get(projectId, kind, hash) as { id: string } | undefined;
      if (hashOwner && hashOwner.id !== section.id) {
        continue;
      }
      if (existing) {
        session.db
          .update(memories)
          .set({
            title,
            body,
            kind,
            projectId,
            contentHash: hash,
            source: section.source ?? existing.source,
            updatedAt: now,
          })
          .where(eq(memories.id, section.id))
          .run();
      } else {
        session.db
          .insert(memories)
          .values({
            id: section.id,
            projectId,
            kind,
            title,
            body,
            source: section.source ?? "markdown",
            contentHash: hash,
            embedding: null,
            createdAt: section.createdAt ?? now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
      }
    }
    const keepIds = new Set(sections.map((section) => section.id));
    const staleSql =
      keepIds.size === 0
        ? "SELECT id FROM memories WHERE project_id = ? AND kind = ?"
        : `SELECT id FROM memories WHERE project_id = ? AND kind = ? AND id NOT IN (${[...keepIds].map(() => "?").join(",")})`;
    const stale = session.sqlite.prepare(staleSql).all(projectId, kind, ...keepIds) as { id: string }[];
    for (const row of stale) {
      session.db.delete(memories).where(eq(memories.id, row.id)).run();
      session.sqlite.prepare("DELETE FROM memory_fts WHERE memory_id = ?").run(row.id);
    }
  }

  private static applyStandupMarkdown(session: ContextSession, markdown: string): void {
    const items = MarkdownCodec.parseStandup(markdown);
    const now = Date.now();
    for (const item of items) {
      const project = session.db.select().from(projects).where(eq(projects.id, item.projectId)).get();
      if (!project) {
        continue;
      }
      const sentence = SecretRedactor.redact(item.sentence);
      session.db
        .insert(standupItems)
        .values({ projectId: item.projectId, sentence, updatedAt: now })
        .onConflictDoUpdate({
          target: standupItems.projectId,
          set: { sentence, updatedAt: now },
        })
        .run();
    }
  }

  private static async maybeImport(
    session: ContextSession,
    relPath: string,
    absPath: string,
    apply: (markdown: string) => void,
  ): Promise<boolean> {
    if (!existsSync(absPath)) {
      return false;
    }
    const fileText = readFileSync(absPath, "utf8");
    const fileHash = ContentHash.bytes(fileText);
    const meta = session.db.select().from(syncMeta).where(eq(syncMeta.relPath, relPath)).get();
    if (meta && meta.fileHash === fileHash) {
      return false;
    }
    const dbNow = SyncEngine.hashDbRows(session, relPath);
    if (meta && meta.fileHash !== fileHash && dbNow !== meta.dbHash) {
      Logger.info(session, "sync.conflict", `${relPath}: DB wins`);
      return false;
    }
    apply(fileText);
    return true;
  }

  private static writeTracked(session: ContextSession, relPath: string, absPath: string, markdown: string): void {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, markdown, "utf8");
    const fileHash = ContentHash.bytes(markdown);
    const dbHash = SyncEngine.hashDbRows(session, relPath);
    const now = Date.now();
    session.db
      .insert(syncMeta)
      .values({ relPath, fileHash, dbHash, updatedAt: now })
      .onConflictDoUpdate({
        target: syncMeta.relPath,
        set: { fileHash, dbHash, updatedAt: now },
      })
      .run();
  }

  private static hashDbRows(session: ContextSession, relPath: string): string {
    if (relPath === "standup.md") {
      const items = session.db
        .select()
        .from(standupItems)
        .all()
        .sort((a, b) => a.projectId.localeCompare(b.projectId))
        .map((row) => `${row.projectId}\t${row.sentence}`)
        .join("\n");
      return ContentHash.bytes(items);
    }
    const match = relPath.match(/^projects\/([^/]+)\/(current-work|discoveries|decisions)\.md$/);
    if (!match) {
      return ContentHash.bytes("");
    }
    const projectId = match[1]!;
    const name = match[2]!;
    if (name === "current-work") {
      const row = session.db.select().from(currentWork).where(eq(currentWork.projectId, projectId)).get();
      return ContentHash.bytes(row?.body ?? "");
    }
    const kind = name === "discoveries" ? "discovery" : "decision";
    const payload = session.db
      .select()
      .from(memories)
      .where(eq(memories.projectId, projectId))
      .all()
      .filter((row) => row.kind === kind)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => `${row.id}\t${row.title}\t${row.body}\t${row.source ?? ""}`)
      .join("\n");
    return ContentHash.bytes(payload);
  }
}
