import { mkdirSync } from "node:fs";
import { AppConfig } from "./config.js";
import { DatabaseClient, type AppDb, type SqliteDatabase } from "./db/client.js";
import { ContextPaths } from "./paths.js";

export class ContextSession {
  constructor(
    readonly paths: ContextPaths,
    readonly config: AppConfig,
    readonly client: DatabaseClient,
  ) {}

  get db(): AppDb {
    return this.client.db;
  }

  get sqlite(): SqliteDatabase {
    return this.client.sqlite;
  }

  static open(homeOverride?: string): ContextSession {
    const paths = ContextPaths.resolve(homeOverride);
    mkdirSync(paths.home, { recursive: true });
    mkdirSync(paths.projectsDir, { recursive: true });
    mkdirSync(paths.dbDir, { recursive: true });
    const client = DatabaseClient.open(paths.sqlitePath);
    const config = AppConfig.load(paths.configFile);
    return new ContextSession(paths, config, client);
  }

  close(): void {
    this.client.close();
  }
}
