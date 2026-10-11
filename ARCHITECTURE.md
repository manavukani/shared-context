# Architecture

Local-first shared memory for AI coding agents (Claude Code, Cursor, Augment Code). One MCP stdio server and one `context` CLI talk to the same SQLite database on disk. No web UI, no cloud, no vector database.

## Modules

```
src/mcp        MCP stdio server (official @modelcontextprotocol/server)
src/cli        `context` CLI (commander)
src/db         Drizzle schema, SQLite client, migrations, FTS5
src/sync       Markdown ↔ SQLite round-trip
src/ai         Optional OpenAI (summarize, classify, duplicate, semantic rank)
src/logging    Operation log (stderr + SQLite); never writes secrets
src/memory     CRUD, dedup, project scoping, stand-up
src/config.ts  ~/.ai-context/config.json
src/paths.ts   Storage layout + AI_CONTEXT_HOME / AI_CONTEXT_DB overrides
```

`ContextSession` is the composition root. MCP tools and CLI commands call `MemoryService` / `SyncEngine` static methods with a session. Future web/cloud/vector/ingest adapters can sit beside these modules without changing the store.

## Storage layout

Default home: `~/.ai-context` (override with `AI_CONTEXT_HOME`). `AI_CONTEXT_DB` may point at a specific SQLite file. Avoid storing SQLite under iCloud-synced `~/Documents`.

```
config.json
standup.md
projects/<project-id>/{current-work.md,discoveries.md,decisions.md}
db/context.sqlite
```

## SQLite schema (source of truth)

| Table            | Role                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `projects`       | id (slug), name, optional repo_path                                   |
| `memories`       | discoveries and decisions; unique `(project_id, kind, content_hash)`  |
| `current_work`   | one row per project                                                   |
| `standup_items`  | one sentence per project; **global** across repos                     |
| `operation_logs` | tool/CLI operations (redacted)                                        |
| `sync_meta`      | last file hash + last DB-row hash per markdown path                   |
| `memory_fts`     | FTS5 over `memories` (`content='memories'`); triggers keep it in sync |
| `work_fts`       | FTS5 over `current_work` (`content='current_work'`)                   |

`memories.embedding` is an optional JSON float array written only when OpenAI is on. That is a column, not a vector database.

## Markdown sync

- **Write path (MCP/CLI):** SQLite commit first, then export markdown, then record hashes in `sync_meta`.
- **Import path (`context sync`, process start):** if a file hash differs from `sync_meta.file_hash` and the current DB-row hash still matches `sync_meta.db_hash`, the file is imported (including deletions of sections missing from markdown). If both file and DB changed, **DB wins** and markdown is overwritten.
- Markdown is Git-friendly and human-editable; it is not the operational source of truth.

Discovery/decision sections include a stable `id` so round-trips do not duplicate rows.

## OpenAI (optional)

Enabled only when `config.ai.enabled` is true **and** `OPENAI_API_KEY` is set.

| Feature                       | Without key  | With key                                                      |
| ----------------------------- | ------------ | ------------------------------------------------------------- |
| CRUD, stand-up, markdown sync | yes          | yes                                                           |
| Duplicate check               | content hash | hash, then cosine similarity on embeddings                    |
| Search                        | SQLite FTS5  | FTS, then optional embedding re-rank                          |
| Summarize / classify          | skipped      | used for stand-up generation and optional kind classification |

Missing key is not an error; `context doctor` reports `ai: degraded`.

## MCP

Stdio transport only (`serveStdio`). Tools validate with Zod. Instructions tell clients to read context before work, persist only meaningful discoveries/decisions, and avoid logging trivia. Project scope: explicit `projectId`, else `cwd` matched to `projects.repo_path`.
