import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { currentWork, memories, projects, standupItems, syncMeta } from "../db/schema.js";
import { ContentHash } from "../hash.js";
import { Logger } from "../logging/logger.js";
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
          const body = MarkdownCodec.parseCurrentWork(md);
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
      const existing = session.db.select().from(memories).where(eq(memories.id, section.id)).get();
      const hash = ContentHash.of(kind, section.title, section.body);
      if (existing) {
        session.db
          .update(memories)
          .set({
            title: section.title,
            body: section.body,
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
            title: section.title,
            body: section.body,
            source: section.source ?? "markdown",
            contentHash: hash,
            embedding: null,
            createdAt: section.createdAt ?? now,
            updatedAt: now,
          })
          .run();
      }
    }
    // Rows present in SQLite but missing from markdown are kept (DB wins; no deletes).
  }

  private static applyStandupMarkdown(session: ContextSession, markdown: string): void {
    const items = MarkdownCodec.parseStandup(markdown);
    const now = Date.now();
    for (const item of items) {
      const project = session.db.select().from(projects).where(eq(projects.id, item.projectId)).get();
      if (!project) {
        continue;
      }
      session.db
        .insert(standupItems)
        .values({ projectId: item.projectId, sentence: item.sentence, updatedAt: now })
        .onConflictDoUpdate({
          target: standupItems.projectId,
          set: { sentence: item.sentence, updatedAt: now },
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
    const dbNow = meta?.dbHash;
    if (meta && meta.fileHash !== fileHash && dbNow && dbNow !== meta.fileHash) {
      Logger.info(session, "sync.conflict", `${relPath}: DB wins`);
      return false;
    }
    apply(fileText);
    return true;
  }

  private static writeTracked(session: ContextSession, relPath: string, absPath: string, markdown: string): void {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, markdown, "utf8");
    const hash = ContentHash.bytes(markdown);
    const now = Date.now();
    session.db
      .insert(syncMeta)
      .values({ relPath, fileHash: hash, dbHash: hash, updatedAt: now })
      .onConflictDoUpdate({
        target: syncMeta.relPath,
        set: { fileHash: hash, dbHash: hash, updatedAt: now },
      })
      .run();
  }
}
