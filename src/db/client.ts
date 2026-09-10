import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export type AppDb = BetterSQLite3Database<typeof schema>;
export type SqliteDatabase = Database.Database;

export class DatabaseClient {
  readonly sqlite: Database.Database;
  readonly db: AppDb;

  constructor(sqlitePath: string) {
    mkdirSync(dirname(sqlitePath), { recursive: true });
    this.sqlite = new Database(sqlitePath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("busy_timeout = 5000");
    this.sqlite.pragma("foreign_keys = ON");
    this.db = drizzle(this.sqlite, { schema });
  }

  static migrationsFolder(): string {
    return fileURLToPath(new URL("../../drizzle", import.meta.url));
  }

  static migrate(sqlitePath: string): DatabaseClient {
    const client = new DatabaseClient(sqlitePath);
    migrate(client.db, { migrationsFolder: DatabaseClient.migrationsFolder() });
    client.ensureFts();
    client.ensureFtsTriggers();
    client.rebuildFtsIfEmpty();
    return client;
  }

  static open(sqlitePath: string): DatabaseClient {
    return DatabaseClient.migrate(sqlitePath);
  }

  ensureFts(): void {
    this.sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        memory_id UNINDEXED,
        project_id UNINDEXED,
        kind,
        title,
        body,
        tokenize = 'porter unicode61'
      );
    `);
  }

  ensureFtsTriggers(): void {
    this.sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(memory_id, project_id, kind, title, body)
        VALUES (new.id, new.project_id, new.kind, new.title, new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        DELETE FROM memory_fts WHERE memory_id = old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        DELETE FROM memory_fts WHERE memory_id = old.id;
        INSERT INTO memory_fts(memory_id, project_id, kind, title, body)
        VALUES (new.id, new.project_id, new.kind, new.title, new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS current_work_ai AFTER INSERT ON current_work BEGIN
        INSERT INTO memory_fts(memory_id, project_id, kind, title, body)
        VALUES ('current:' || new.project_id, new.project_id, 'current_work', 'Current work', new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS current_work_ad AFTER DELETE ON current_work BEGIN
        DELETE FROM memory_fts WHERE memory_id = 'current:' || old.project_id;
      END;
      CREATE TRIGGER IF NOT EXISTS current_work_au AFTER UPDATE ON current_work BEGIN
        DELETE FROM memory_fts WHERE memory_id = 'current:' || old.project_id;
        INSERT INTO memory_fts(memory_id, project_id, kind, title, body)
        VALUES ('current:' || new.project_id, new.project_id, 'current_work', 'Current work', new.body);
      END;
    `);
  }

  rebuildFtsIfEmpty(): void {
    const ready = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'memories'").get();
    if (!ready) {
      return;
    }
    const fts = this.sqlite.prepare("SELECT count(*) AS c FROM memory_fts").get() as { c: number };
    if (fts.c > 0) {
      return;
    }
    const mems = this.sqlite.prepare("SELECT count(*) AS c FROM memories").get() as { c: number };
    const works = this.sqlite.prepare("SELECT count(*) AS c FROM current_work").get() as { c: number };
    if (mems.c + works.c === 0) {
      return;
    }
    this.rebuildFts();
  }

  rebuildFts(): void {
    const ready = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'memories'").get();
    if (!ready) {
      return;
    }
    this.sqlite.exec("DELETE FROM memory_fts");
    const insert = this.sqlite.prepare(
      "INSERT INTO memory_fts (memory_id, project_id, kind, title, body) VALUES (?, ?, ?, ?, ?)",
    );
    const mems = this.sqlite.prepare("SELECT id, project_id, kind, title, body FROM memories").all() as {
      id: string;
      project_id: string;
      kind: string;
      title: string;
      body: string;
    }[];
    for (const row of mems) {
      insert.run(row.id, row.project_id, row.kind, row.title, row.body);
    }
    const works = this.sqlite.prepare("SELECT project_id, body FROM current_work").all() as {
      project_id: string;
      body: string;
    }[];
    for (const row of works) {
      insert.run(`current:${row.project_id}`, row.project_id, "current_work", "Current work", row.body);
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
