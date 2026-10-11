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

  private ftsSql(name: string): string | undefined {
    const row = this.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as
      { sql: string } | undefined;
    return row?.sql;
  }

  private usesExternalContent(): boolean {
    const memory = this.ftsSql("memory_fts") ?? "";
    const work = this.ftsSql("work_fts") ?? "";
    return /content=['"]memories['"]/i.test(memory) && /content=['"]current_work['"]/i.test(work);
  }

  private dropFtsTriggers(): void {
    this.sqlite.exec(`
      DROP TRIGGER IF EXISTS memories_ai;
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_au;
      DROP TRIGGER IF EXISTS current_work_ai;
      DROP TRIGGER IF EXISTS current_work_ad;
      DROP TRIGGER IF EXISTS current_work_au;
    `);
  }

  ensureFts(): void {
    if (!this.usesExternalContent()) {
      this.dropFtsTriggers();
      this.sqlite.exec("DROP TABLE IF EXISTS memory_fts");
      this.sqlite.exec("DROP TABLE IF EXISTS work_fts");
    }
    this.sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        title,
        body,
        content='memories',
        content_rowid='rowid',
        tokenize = 'porter unicode61'
      );
    `);
    this.sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS work_fts USING fts5(
        body,
        content='current_work',
        content_rowid='rowid',
        tokenize = 'porter unicode61'
      );
    `);
  }

  ensureFtsTriggers(): void {
    this.dropFtsTriggers();
    this.sqlite.exec(`
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
      END;
      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
        INSERT INTO memory_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
      CREATE TRIGGER current_work_ai AFTER INSERT ON current_work BEGIN
        INSERT INTO work_fts(rowid, body) VALUES (new.rowid, new.body);
      END;
      CREATE TRIGGER current_work_ad AFTER DELETE ON current_work BEGIN
        INSERT INTO work_fts(work_fts, rowid, body) VALUES('delete', old.rowid, old.body);
      END;
      CREATE TRIGGER current_work_au AFTER UPDATE ON current_work BEGIN
        INSERT INTO work_fts(work_fts, rowid, body) VALUES('delete', old.rowid, old.body);
        INSERT INTO work_fts(rowid, body) VALUES (new.rowid, new.body);
      END;
    `);
  }

  rebuildFtsIfEmpty(): void {
    const ready = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'memories'").get();
    if (!ready) {
      return;
    }
    const memFts = this.sqlite.prepare("SELECT count(*) AS c FROM memory_fts").get() as { c: number };
    const workFts = this.sqlite.prepare("SELECT count(*) AS c FROM work_fts").get() as { c: number };
    const mems = this.sqlite.prepare("SELECT count(*) AS c FROM memories").get() as { c: number };
    const works = this.sqlite.prepare("SELECT count(*) AS c FROM current_work").get() as { c: number };
    if ((mems.c > 0 && memFts.c === 0) || (works.c > 0 && workFts.c === 0)) {
      this.rebuildFts();
    }
  }

  rebuildFts(): void {
    const ready = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'memories'").get();
    if (!ready) {
      return;
    }
    this.sqlite.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
    this.sqlite.exec("INSERT INTO work_fts(work_fts) VALUES('rebuild')");
  }

  close(): void {
    this.sqlite.close();
  }
}
