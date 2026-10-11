import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repoPath: text("repo_path"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    source: text("source"),
    contentHash: text("content_hash").notNull(),
    embedding: text("embedding"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("memories_project_kind_hash").on(table.projectId, table.kind, table.contentHash)],
);

export const currentWork = sqliteTable("current_work", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id),
  body: text("body").notNull(),
  source: text("source"),
  updatedAt: integer("updated_at").notNull(),
});

export const standupItems = sqliteTable("standup_items", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id),
  sentence: text("sentence").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const operationLogs = sqliteTable("operation_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operation: text("operation").notNull(),
  projectId: text("project_id"),
  detail: text("detail"),
  createdAt: integer("created_at").notNull(),
});

export const syncMeta = sqliteTable("sync_meta", {
  relPath: text("rel_path").primaryKey(),
  fileHash: text("file_hash").notNull(),
  dbHash: text("db_hash").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type CurrentWorkRow = typeof currentWork.$inferSelect;
export type StandupItemRow = typeof standupItems.$inferSelect;
