import { and, desc, eq } from "drizzle-orm";
import { resolve } from "node:path";
import { OpenAiLayer } from "../ai/openai.js";
import { currentWork, memories, projects, standupItems } from "../db/schema.js";
import { ContentHash } from "../hash.js";
import { Logger } from "../logging/logger.js";
import { SecretRedactor } from "../secrets.js";
import type { ContextSession } from "../session.js";
import { SyncEngine } from "../sync/engine.js";
import type { MemoryKind } from "../sync/markdown.js";

export const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SOURCES = ["claude-code", "cursor", "augment", "cli", "markdown", "unknown"] as const;
export type Source = (typeof SOURCES)[number];

export type SaveMemoryInput = {
  projectId?: string;
  cwd?: string;
  title: string;
  body: string;
  source?: string;
  kind?: MemoryKind;
};

export type SearchInput = {
  query: string;
  projectId?: string;
  kind?: MemoryKind | "current_work";
  limit?: number;
};

export class MemoryService {
  static async initHome(session: ContextSession): Promise<void> {
    const { AppConfig } = await import("../config.js");
    AppConfig.write(session.paths.configFile, session.config.data);
    await SyncEngine.exportAll(session);
    Logger.info(session, "init", session.paths.home);
  }

  static addProject(
    session: ContextSession,
    input: { id: string; name?: string; repoPath?: string },
  ): { id: string; name: string; created: boolean } {
    const id = MemoryService.requireProjectId(input.id);
    const existing = session.db.select().from(projects).where(eq(projects.id, id)).get();
    if (existing) {
      const now = Date.now();
      session.db
        .update(projects)
        .set({
          name: input.name?.trim() || existing.name,
          repoPath: input.repoPath ? resolve(input.repoPath) : existing.repoPath,
          updatedAt: now,
        })
        .where(eq(projects.id, id))
        .run();
      Logger.info(session, "project.update", existing.name, id);
      return { id, name: input.name?.trim() || existing.name, created: false };
    }
    const now = Date.now();
    const name = input.name?.trim() || id;
    session.db
      .insert(projects)
      .values({
        id,
        name,
        repoPath: input.repoPath ? resolve(input.repoPath) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    Logger.info(session, "project.add", name, id);
    return { id, name, created: true };
  }

  static listProjects(session: ContextSession) {
    return session.db.select().from(projects).all().sort((a, b) => a.id.localeCompare(b.id));
  }

  static resolveProjectId(session: ContextSession, projectId?: string, cwd?: string): string {
    if (projectId) {
      const id = MemoryService.requireProjectId(projectId);
      const row = session.db.select().from(projects).where(eq(projects.id, id)).get();
      if (!row) {
        throw new Error(`Unknown project '${id}'. Run: context project add ${id}`);
      }
      return id;
    }
    const fromCwd = cwd ? resolve(cwd) : process.cwd();
    const matches = MemoryService.listProjects(session)
      .filter((p) => p.repoPath && (fromCwd === p.repoPath || fromCwd.startsWith(`${p.repoPath}/`)))
      .sort((a, b) => (b.repoPath?.length ?? 0) - (a.repoPath?.length ?? 0));
    if (matches[0]) {
      return matches[0].id;
    }
    const all = MemoryService.listProjects(session);
    if (all.length === 1) {
      return all[0]!.id;
    }
    throw new Error("Pass projectId (or add --repo when creating the project so cwd can be matched).");
  }

  static async saveDiscovery(session: ContextSession, input: SaveMemoryInput) {
    return MemoryService.saveMemory(session, { ...input, kind: "discovery" });
  }

  static async saveDecision(session: ContextSession, input: SaveMemoryInput) {
    return MemoryService.saveMemory(session, { ...input, kind: "decision" });
  }

  static async saveMemory(session: ContextSession, input: SaveMemoryInput) {
    const title = SecretRedactor.redact(input.title.trim());
    const body = SecretRedactor.redact(input.body.trim());
    if (!title) {
      throw new Error("title is required");
    }
    if (!body) {
      throw new Error("body is required");
    }
    const ai = new OpenAiLayer(session.config);
    let kind: MemoryKind = input.kind ?? "discovery";
    if (!input.kind) {
      kind = (await ai.classifyKind(title, body)) ?? "discovery";
    }
    const projectId = MemoryService.resolveProjectId(session, input.projectId, input.cwd);
    const source = MemoryService.normalizeSource(input.source);
    const contentHash = ContentHash.of(kind, title, body);
    const duplicate = session.db
      .select()
      .from(memories)
      .where(and(eq(memories.projectId, projectId), eq(memories.kind, kind), eq(memories.contentHash, contentHash)))
      .get();
    if (duplicate) {
      Logger.info(session, "memory.duplicate", `${kind} ${duplicate.id}`, projectId);
      return { saved: false, duplicate: true as const, memory: duplicate };
    }
    const semanticDup = await MemoryService.findSemanticDuplicate(session, ai, projectId, kind, `${title}\n${body}`);
    if (semanticDup) {
      Logger.info(session, "memory.duplicate", `${kind} semantic ${semanticDup.id}`, projectId);
      return { saved: false, duplicate: true as const, memory: semanticDup };
    }
    const embedding = await ai.embed(`${title}\n${body}`);
    const now = Date.now();
    const id = crypto.randomUUID();
    session.db
      .insert(memories)
      .values({
        id,
        projectId,
        kind,
        title,
        body,
        source,
        contentHash,
        embedding: embedding ? JSON.stringify(embedding) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    MemoryService.upsertFts(session, {
      id,
      projectId,
      kind,
      title,
      body,
    });
    await SyncEngine.exportMemories(session, projectId, kind);
    Logger.info(session, "memory.save", `${kind} ${id} ${title}`, projectId);
    return {
      saved: true,
      duplicate: false as const,
      memory: session.db.select().from(memories).where(eq(memories.id, id)).get()!,
    };
  }

  static async updateCurrentWork(
    session: ContextSession,
    input: { projectId?: string; cwd?: string; body: string; source?: string },
  ) {
    const body = SecretRedactor.redact(input.body.trim());
    if (!body) {
      throw new Error("body is required");
    }
    const projectId = MemoryService.resolveProjectId(session, input.projectId, input.cwd);
    const now = Date.now();
    session.db
      .insert(currentWork)
      .values({ projectId, body, source: MemoryService.normalizeSource(input.source), updatedAt: now })
      .onConflictDoUpdate({
        target: currentWork.projectId,
        set: { body, source: MemoryService.normalizeSource(input.source), updatedAt: now },
      })
      .run();
    MemoryService.upsertFts(session, {
      id: `current:${projectId}`,
      projectId,
      kind: "current_work",
      title: "Current work",
      body,
    });
    await SyncEngine.exportCurrentWork(session, projectId);
    Logger.info(session, "current_work.update", `${body.slice(0, 80)}`, projectId);
    return { projectId, body };
  }

  static getCurrentWork(session: ContextSession, projectId?: string, cwd?: string) {
    const id = MemoryService.resolveProjectId(session, projectId, cwd);
    const row = session.db.select().from(currentWork).where(eq(currentWork.projectId, id)).get();
    const project = session.db.select().from(projects).where(eq(projects.id, id)).get()!;
    Logger.info(session, "current_work.get", "ok", id);
    return { project, currentWork: row?.body ?? "" };
  }

  static getProjectContext(session: ContextSession, projectId?: string, cwd?: string) {
    const id = MemoryService.resolveProjectId(session, projectId, cwd);
    const project = session.db.select().from(projects).where(eq(projects.id, id)).get()!;
    const work = session.db.select().from(currentWork).where(eq(currentWork.projectId, id)).get();
    const recent = session.db
      .select()
      .from(memories)
      .where(eq(memories.projectId, id))
      .orderBy(desc(memories.createdAt))
      .limit(12)
      .all();
    const standup = session.db.select().from(standupItems).where(eq(standupItems.projectId, id)).get();
    Logger.info(session, "project_context.get", `${recent.length} memories`, id);
    return {
      project,
      currentWork: work?.body ?? "",
      standup: standup?.sentence ?? "",
      discoveries: recent.filter((m) => m.kind === "discovery"),
      decisions: recent.filter((m) => m.kind === "decision"),
    };
  }

  static async search(session: ContextSession, input: SearchInput) {
    const query = input.query.trim();
    if (!query) {
      throw new Error("query is required");
    }
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 25);
    const ftsQuery = MemoryService.escapeFts(query);
    let sql = `SELECT memory_id, kind, title, body, project_id, rank
      FROM memory_fts
      WHERE memory_fts MATCH ?
    `;
    const params: unknown[] = [ftsQuery];
    if (input.projectId) {
      sql += " AND project_id = ?";
      params.push(MemoryService.requireProjectId(input.projectId));
    }
    if (input.kind) {
      sql += " AND kind = ?";
      params.push(input.kind);
    }
    sql += " ORDER BY rank LIMIT ?";
    params.push(limit);
    let rows = session.sqlite.prepare(sql).all(...params) as {
      memory_id: string;
      kind: string;
      title: string;
      body: string;
      project_id: string;
      rank: number;
    }[];

    const ai = new OpenAiLayer(session.config);
    if (ai.enabled && rows.length > 0) {
      const qEmbed = await ai.embed(query);
      if (qEmbed) {
        rows = rows
          .map((row) => {
            const mem = row.memory_id.startsWith("current:")
              ? null
              : session.db.select().from(memories).where(eq(memories.id, row.memory_id)).get();
            const emb = OpenAiLayer.parseEmbedding(mem?.embedding ?? null);
            const score = emb ? OpenAiLayer.cosine(qEmbed, emb) : 0;
            return { ...row, score };
          })
          .sort((a, b) => b.score - a.score);
      }
    }

    Logger.info(session, "memory.search", `"${query}" -> ${rows.length}`, input.projectId);
    return rows.map((row) => ({
      id: row.memory_id,
      projectId: row.project_id,
      kind: row.kind,
      title: row.title,
      excerpt: MemoryService.excerpt(row.body, query),
    }));
  }

  static getStandup(session: ContextSession) {
    const items = session.db.select().from(standupItems).all().sort((a, b) => a.projectId.localeCompare(b.projectId));
    Logger.info(session, "standup.get", `${items.length} item(s)`);
    return items;
  }

  static async updateStandup(
    session: ContextSession,
    input: {
      projectId?: string;
      sentence?: string;
      items?: { projectId: string; sentence: string }[];
      generate?: boolean;
    },
  ) {
    const now = Date.now();
    if (input.generate) {
      const generated = await MemoryService.generateStandup(session);
      for (const item of generated) {
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
    const items = input.items ?? [];
    if (input.projectId && input.sentence) {
      items.push({ projectId: input.projectId, sentence: input.sentence });
    }
    for (const item of items) {
      const projectId = MemoryService.resolveProjectId(session, item.projectId);
      const sentence = MemoryService.oneSentence(SecretRedactor.redact(item.sentence));
      if (!sentence) {
        continue;
      }
      session.db
        .insert(standupItems)
        .values({ projectId, sentence, updatedAt: now })
        .onConflictDoUpdate({
          target: standupItems.projectId,
          set: { sentence, updatedAt: now },
        })
        .run();
    }
    await SyncEngine.exportStandup(session);
    const all = MemoryService.getStandup(session);
    Logger.info(session, "standup.update", `${all.length} item(s)`);
    return all;
  }

  static async generateStandup(session: ContextSession): Promise<{ projectId: string; sentence: string }[]> {
    const ai = new OpenAiLayer(session.config);
    const works = session.db.select().from(currentWork).all();
    const items: { projectId: string; sentence: string }[] = [];
    for (const work of works) {
      if (!work.body.trim()) {
        continue;
      }
      const aiSentence = await ai.oneSentence(work.body);
      items.push({
        projectId: work.projectId,
        sentence: MemoryService.oneSentence(aiSentence ?? work.body),
      });
    }
    return items;
  }

  static doctor(session: ContextSession) {
    const ai = new OpenAiLayer(session.config);
    const tables = session.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
      .all() as { name: string }[];
    const names = new Set(tables.map((t) => t.name));
    const required = ["projects", "memories", "current_work", "standup_items", "operation_logs", "sync_meta"];
    const missing = required.filter((name) => !names.has(name));
    const fts = session.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE name = 'memory_fts'")
      .get() as { name: string } | undefined;
    const healthy = missing.length === 0 && Boolean(fts);
    return {
      healthy,
      home: session.paths.home,
      sqlite: session.paths.sqlitePath,
      config: session.paths.configFile,
      projects: MemoryService.listProjects(session).length,
      memories: session.db.select().from(memories).all().length,
      missingTables: missing,
      fts: Boolean(fts),
      ai: ai.status,
    };
  }

  static requireProjectId(id: string): string {
    const normalized = id.trim().toLowerCase();
    if (!PROJECT_ID_RE.test(normalized)) {
      throw new Error("project id must be a lowercase slug (letters, numbers, hyphens)");
    }
    return normalized;
  }

  static normalizeSource(source?: string): Source {
    if (source && (SOURCES as readonly string[]).includes(source)) {
      return source as Source;
    }
    return "unknown";
  }

  static oneSentence(text: string): string {
    const cleaned = text.replace(/\s+/g, " ").trim();
    const sentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
    return sentence.length > 140 ? `${sentence.slice(0, 137).trimEnd()}...` : sentence;
  }

  static excerpt(body: string, query: string, radius = 80): string {
    const hay = body.replace(/\s+/g, " ").trim();
    const needle = query.split(/\s+/)[0]?.toLowerCase() ?? "";
    const idx = hay.toLowerCase().indexOf(needle);
    if (idx < 0) {
      return hay.slice(0, radius * 2);
    }
    const start = Math.max(0, idx - radius);
    const end = Math.min(hay.length, idx + needle.length + radius);
    return `${start > 0 ? "…" : ""}${hay.slice(start, end)}${end < hay.length ? "…" : ""}`;
  }

  static escapeFts(query: string): string {
    return query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => `"${token.replace(/"/g, '""')}"`)
      .join(" AND ");
  }

  static upsertFts(
    session: ContextSession,
    row: { id: string; projectId: string; kind: string; title: string; body: string },
  ): void {
    session.sqlite.prepare("DELETE FROM memory_fts WHERE memory_id = ?").run(row.id);
    session.sqlite
      .prepare("INSERT INTO memory_fts (memory_id, project_id, kind, title, body) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.projectId, row.kind, row.title, row.body);
  }

  private static async findSemanticDuplicate(
    session: ContextSession,
    ai: OpenAiLayer,
    projectId: string,
    kind: MemoryKind,
    text: string,
  ) {
    if (!ai.enabled) {
      return null;
    }
    const embedding = await ai.embed(text);
    if (!embedding) {
      return null;
    }
    const candidates = session.db
      .select()
      .from(memories)
      .where(and(eq(memories.projectId, projectId), eq(memories.kind, kind)))
      .all();
    let best: (typeof candidates)[number] | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const other = OpenAiLayer.parseEmbedding(candidate.embedding);
      if (!other) {
        continue;
      }
      const score = OpenAiLayer.cosine(embedding, other);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return bestScore >= 0.92 ? best : null;
  }
}
