# shared-context

Local-first shared memory for **Claude Code**, **Cursor**, and **Augment Code**. One MCP stdio server and one `context` CLI write to the same SQLite database on your machine so agents can share project knowledge without a cloud service, web UI, or vector database.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for modules, schema, sync rules, and where OpenAI is optional.

## Behavior for coding agents

Read this before wiring the MCP server into a harness:

1. **Read before you work.** Call `get_project_context` (or `get_current_work`) for the repo you are in before meaningful implementation.
2. **Write only what is reusable.** `save_discovery` / `save_decision` are for gotchas, constraints, and choices — not every tool call or trivial edit.
3. **Update progress sparingly.** `update_current_work` and `update_standup` only after meaningful progress.
4. **Stand-up is global.** One sentence per work item, across all repos. Do not dump logs into it.
5. **Stay on the right project.** Pass `projectId` (for example `issuer-ui`) or register `--repo` so `cwd` resolves correctly.
6. **Never store secrets.** Tokens, keys, and passwords are redacted, but do not paste them.

## Storage

Default home: `~/.ai-context` (override with `--home` or `AI_CONTEXT_HOME`).
CLI and MCP entrypoints load a `.env` file from the process working directory (existing environment variables win). `AI_CONTEXT_DB` optionally overrides the SQLite file path (otherwise `db/context.sqlite` under the home).

The previous default (`~/Documents/ai-context`) sat on iCloud Drive on many Macs; SQLite WAL files under a file-sync daemon can corrupt. Existing data can be pointed at with `AI_CONTEXT_HOME`.

```
config.json
standup.md
projects/<project-id>/{current-work.md,discoveries.md,decisions.md}
db/context.sqlite
```

SQLite is the operational source of truth. Markdown is the Git-friendly human copy. On conflict, **the database wins** (see ARCHITECTURE.md).

## Install

Requires Node.js 20+.

```bash
git clone https://github.com/manavukani/shared-context.git
cd shared-context
npm install
npm run build
npm link          # exposes the `context` binary
```

Or run without linking:

```bash
npm run context -- --help
npm run start:mcp
```

### Initialize local storage

```bash
context init
context doctor
```

`context doctor` should report `"healthy": true`.

### Register a project

```bash
context project add issuer-ui --name "Issuer UI" --repo /path/to/issuer-ui
```

## MCP tools

| Tool                  | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `get_project_context` | Current work + stand-up line + recent discoveries/decisions |
| `get_current_work`    | Current-work note only                                      |
| `save_discovery`      | Reusable finding (deduped)                                  |
| `save_decision`       | Reusable choice (deduped)                                   |
| `update_current_work` | Replace current work after real progress                    |
| `search_memory`       | SQLite FTS5 (optional OpenAI re-rank)                       |
| `get_standup`         | Global stand-up                                             |
| `update_standup`      | Set sentences, or `generate: true` from current work        |

Inputs are Zod-validated. Duplicate memories return the existing row instead of inserting. Operations are logged to stderr and `operation_logs` (redacted).

## Claude Code

Project `.mcp.json` or user config:

```json
{
  "mcpServers": {
    "shared-context": {
      "command": "node",
      "args": ["/ABS/PATH/shared-context/dist/mcp/index.js"]
    }
  }
}
```

CLI:

```bash
claude mcp add shared-context -- node /ABS/PATH/shared-context/dist/mcp/index.js
```

See `examples/mcp/claude-code.json`.

## Cursor

`~/.cursor/mcp.json` or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "shared-context": {
      "command": "node",
      "args": ["/ABS/PATH/shared-context/dist/mcp/index.js"]
    }
  }
}
```

See `examples/mcp/cursor.json`. After saving, reload MCP tools.

## Augment Code

Add a stdio server in `~/.augment/settings.json` (or via `auggie mcp add-json`):

```json
{
  "mcpServers": {
    "shared-context": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABS/PATH/shared-context/dist/mcp/index.js"]
    }
  }
}
```

```bash
auggie mcp add-json shared-context '{"type":"stdio","command":"node","args":["/ABS/PATH/shared-context/dist/mcp/index.js"]}'
```

See `examples/mcp/augment.json`.

## CLI

```bash
context init
context project list
context project add issuer-ui --name "Issuer UI" --repo ~/src/issuer-ui
context memory save --kind discovery --project issuer-ui --title "PKCE" --body "Public clients must use PKCE." --source claude-code
context memory search PKCE
context standup update --project issuer-ui --sentence "Shipping OAuth refresh."
context standup update --from-current-work
context standup show
context standup update --from-current-work
context work show --project issuer-ui
context work update --project issuer-ui --body "Adding PKCE." --source cursor
context sync
context doctor
```

Global option: `--home <path>` (also `AI_CONTEXT_HOME`).

npm scripts: `build`, `start:mcp`, `context`, `test`, `migrate`.

## Optional OpenAI

Set `OPENAI_API_KEY` and leave `ai.enabled` true in `config.json` to turn on:

- one-sentence stand-up generation
- optional kind classification when kind is omitted
- embedding duplicate detection
- semantic re-rank of FTS results

Without a key, CRUD + FTS work. `context doctor` reports `"ai": "degraded"` (not a failure).

## Demo / acceptance

```bash
./scripts/acceptance.sh
```

The script uses a temp `AI_CONTEXT_HOME` and covers:

1. Register `issuer-ui`
2. Save a discovery (Claude Code)
3. Retrieve it (Cursor)
4. Save a decision (Augment)
5. Retrieve it (Claude Code)
6. Update current work
7. Generate a concise global stand-up
8. Confirm markdown files updated
9. Restart and confirm persistence
10. `context doctor` healthy

Example files live in `examples/`.

## Tests

```bash
npm test
```

Unit tests cover hashing, secret redaction, and markdown codecs. Integration tests cover the store, CLI, markdown sync, and MCP tools.

## What this is not

No dashboard, no hosted service, no new coding agent, no automatic chat ingest, no GitHub/Slack sync, no vector database. Those can be added later as extra modules beside `src/memory`.
