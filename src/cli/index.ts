#!/usr/bin/env node
import { Command } from "commander";
import { AppConfig } from "../config.js";
import { EnvFile } from "../env.js";
import { MemoryService } from "../memory/service.js";
import { ResultFormat } from "../memory/format.js";
import { ContextSession } from "../session.js";
import { SyncEngine } from "../sync/engine.js";

EnvFile.load();

function withSession<T>(home: string | undefined, fn: (session: ContextSession) => Promise<T> | T): Promise<T> {
  const session = ContextSession.open(home);
  return Promise.resolve(fn(session)).finally(() => session.close());
}

function fail(error: unknown): never {
  const text = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${text}\n`);
  process.exit(1);
}

const program = new Command();
program
  .name("context")
  .description("Local-first shared AI context (CLI + MCP)")
  .option("--home <path>", "Override context home (or set AI_CONTEXT_HOME)")
  .option("--cwd <path>", "Working directory used to auto-detect the project")
  .showHelpAfterError();

program.hook("preAction", (thisCommand) => {
  const opts = thisCommand.optsWithGlobals<{ home?: string }>();
  if (opts.home) {
    process.env.AI_CONTEXT_HOME = opts.home;
  }
});

program
  .command("init")
  .description("Create ~/.ai-context (or --home) and migrate SQLite")
  .action(async () => {
    try {
      const home = program.opts<{ home?: string }>().home;
      await withSession(home, async (session) => {
        AppConfig.write(session.paths.configFile);
        await MemoryService.initHome(session);
        const health = await MemoryService.doctor(session);
        process.stdout.write(`Initialized ${session.paths.home}\n`);
        process.stdout.write(`SQLite ${session.paths.sqlitePath}\n`);
        process.stdout.write(`doctor: ${health.healthy ? "healthy" : "unhealthy"}\n`);
      });
    } catch (error) {
      fail(error);
    }
  });

const project = program.command("project").description("Manage registered projects");

project
  .command("list")
  .description("List projects")
  .action(async () => {
    try {
      await withSession(program.opts<{ home?: string }>().home, (session) => {
        const rows = MemoryService.listProjects(session);
        if (rows.length === 0) {
          process.stdout.write("No projects. Try: context project add issuer-ui\n");
          return;
        }
        for (const row of rows) {
          process.stdout.write(`${row.id}\t${row.name}${row.repoPath ? `\t${row.repoPath}` : ""}\n`);
        }
      });
    } catch (error) {
      fail(error);
    }
  });

project
  .command("add")
  .argument("<id>", "Project slug, e.g. issuer-ui")
  .option("--name <name>", "Display name")
  .option("--repo <path>", "Local repo path used to auto-scope MCP tools")
  .action(async (id: string, opts: { name?: string; repo?: string }) => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        const result = MemoryService.addProject(session, { id, name: opts.name, repoPath: opts.repo });
        await SyncEngine.exportAll(session);
        process.stdout.write(`${result.created ? "added" : "updated"} ${result.id} (${result.name})\n`);
      });
    } catch (error) {
      fail(error);
    }
  });

project
  .command("remove")
  .argument("<id>", "Project slug")
  .description("Delete a project and its memories, current work, and stand-up line")
  .action(async (id: string) => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        const result = await MemoryService.removeProject(session, id);
        process.stdout.write(ResultFormat.removedProject(result.id));
      });
    } catch (error) {
      fail(error);
    }
  });

const memory = program.command("memory").description("Search and save memories");

memory
  .command("search")
  .argument("<query...>", "Full-text query")
  .option("--project <id>", "Limit to a project")
  .option("--kind <kind>", "discovery | decision | current_work")
  .option("--limit <n>", "Max results (1-25)", (value: string) => Number(value))
  .action(async (queryParts: string[], opts: { project?: string; kind?: string; limit?: number }) => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        const kind =
          opts.kind === "discovery" || opts.kind === "decision" || opts.kind === "current_work" ? opts.kind : undefined;
        const rows = await MemoryService.search(session, {
          query: queryParts.join(" "),
          projectId: opts.project,
          kind,
          limit: Number.isFinite(opts.limit) ? opts.limit : undefined,
        });
        process.stdout.write(ResultFormat.search(rows));
      });
    } catch (error) {
      fail(error);
    }
  });

memory
  .command("save")
  .requiredOption("--kind <kind>", "discovery | decision")
  .option("--project <id>", "Project slug (optional when cwd matches a registered repo)")
  .option("--cwd <path>", "Working directory to match a registered repo")
  .requiredOption("--title <title>", "Short title")
  .requiredOption("--body <body>", "Details")
  .option("--source <source>", "claude-code | cursor | augment | cli", "cli")
  .action(
    async (opts: { kind: string; project?: string; cwd?: string; title: string; body: string; source?: string }) => {
      try {
        if (opts.kind !== "discovery" && opts.kind !== "decision") {
          throw new Error("--kind must be discovery or decision");
        }
        const kind = opts.kind;
        await withSession(program.opts<{ home?: string }>().home, async (session) => {
          const result = await MemoryService.saveMemory(session, {
            kind,
            projectId: opts.project,
            cwd: opts.cwd ?? program.opts<{ cwd?: string }>().cwd,
            title: opts.title,
            body: opts.body,
            source: opts.source,
          });
          process.stdout.write(ResultFormat.saved(result));
        });
      } catch (error) {
        fail(error);
      }
    },
  );

memory
  .command("delete")
  .requiredOption("--id <id>", "Memory UUID")
  .description("Delete a discovery or decision")
  .action(async (opts: { id: string }) => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        const result = await MemoryService.deleteMemory(session, opts.id);
        process.stdout.write(ResultFormat.deleted(result.memory.id));
      });
    } catch (error) {
      fail(error);
    }
  });

memory
  .command("edit")
  .requiredOption("--id <id>", "Memory UUID")
  .option("--title <title>", "Replacement title")
  .option("--body <body>", "Replacement body")
  .option("--source <source>", "claude-code | cursor | augment | cli")
  .description("Edit a discovery or decision")
  .action(async (opts: { id: string; title?: string; body?: string; source?: string }) => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        const memory = await MemoryService.editMemory(session, opts);
        process.stdout.write(ResultFormat.saved({ saved: true, duplicate: false, memory }));
      });
    } catch (error) {
      fail(error);
    }
  });

const standup = program.command("standup").description("Global stand-up");

standup
  .command("show")
  .description("Print the global stand-up")
  .action(async () => {
    try {
      await withSession(program.opts<{ home?: string }>().home, (session) => {
        process.stdout.write(ResultFormat.standup(MemoryService.getStandup(session)));
      });
    } catch (error) {
      fail(error);
    }
  });

standup
  .command("update")
  .description("Update stand-up (one sentence per work item)")
  .option("--project <id>", "Project whose sentence to set")
  .option("--sentence <text>", "One-sentence status")
  .option("--from-current-work", "Generate sentences from each project's current work")
  .action(async (opts: { project?: string; sentence?: string; fromCurrentWork?: boolean }) => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        if (opts.project && !opts.sentence && !opts.fromCurrentWork) {
          throw new Error("standup update --project requires --sentence (or pass --from-current-work)");
        }
        const items = await MemoryService.updateStandup(session, {
          projectId: opts.project,
          sentence: opts.sentence,
          generate: Boolean(opts.fromCurrentWork),
        });
        process.stdout.write(ResultFormat.standup(items));
      });
    } catch (error) {
      fail(error);
    }
  });

const work = program.command("work").description("Per-project current work");

work
  .command("show")
  .description("Show current work")
  .option("--project <id>", "Project slug")
  .option("--cwd <path>", "Working directory to match a registered repo")
  .action(async (opts: { project?: string; cwd?: string }) => {
    try {
      await withSession(program.opts<{ home?: string }>().home, (session) => {
        const ctx = MemoryService.getCurrentWork(
          session,
          opts.project,
          opts.cwd ?? program.opts<{ cwd?: string }>().cwd,
        );
        process.stdout.write(ResultFormat.currentWork(ctx.project, ctx.currentWork));
      });
    } catch (error) {
      fail(error);
    }
  });

work
  .command("update")
  .description("Replace current work after meaningful progress")
  .option("--project <id>", "Project slug (optional when cwd matches a registered repo)")
  .option("--cwd <path>", "Working directory to match a registered repo")
  .requiredOption("--body <body>", "Current work notes")
  .option("--source <source>", "claude-code | cursor | augment | cli", "cli")
  .action(async (opts: { project?: string; cwd?: string; body: string; source?: string }) => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        const result = await MemoryService.updateCurrentWork(session, {
          projectId: opts.project,
          cwd: opts.cwd ?? program.opts<{ cwd?: string }>().cwd,
          body: opts.body,
          source: opts.source,
        });
        process.stdout.write(
          ResultFormat.currentWork(MemoryService.getCurrentWork(session, result.projectId).project, result.body),
        );
      });
    } catch (error) {
      fail(error);
    }
  });

work
  .command("clear")
  .description("Clear current work for a project")
  .option("--project <id>", "Project slug")
  .option("--cwd <path>", "Working directory to match a registered repo")
  .action(async (opts: { project?: string; cwd?: string }) => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        const result = await MemoryService.clearCurrentWork(
          session,
          opts.project,
          opts.cwd ?? program.opts<{ cwd?: string }>().cwd,
        );
        process.stdout.write(
          ResultFormat.currentWork(MemoryService.getCurrentWork(session, result.projectId).project, result.body),
        );
      });
    } catch (error) {
      fail(error);
    }
  });

program
  .command("sync")
  .description("Two-way markdown sync (DB wins on conflict)")
  .action(async () => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        const result = await SyncEngine.importThenExport(session);
        process.stdout.write(`sync ok; imported ${result.imported.length} file(s)\n`);
        if (result.imported.length > 0) {
          process.stdout.write(result.imported.map((p) => `  ${p}`).join("\n") + "\n");
        }
      });
    } catch (error) {
      fail(error);
    }
  });

program
  .command("doctor")
  .description("Check that local context storage is healthy")
  .action(async () => {
    try {
      await withSession(program.opts<{ home?: string }>().home, async (session) => {
        const health = await MemoryService.doctor(session);
        process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
        if (!health.healthy) {
          process.exitCode = 1;
        }
      });
    } catch (error) {
      fail(error);
    }
  });

function addHomeOption(command: Command): void {
  if (!command.options.some((opt) => opt.long === "--home")) {
    command.option("--home <path>", "Override context home (or set AI_CONTEXT_HOME)");
  }
  for (const child of command.commands) {
    addHomeOption(child);
  }
}

for (const command of program.commands) {
  addHomeOption(command);
}

program.parseAsync(process.argv).catch(fail);
