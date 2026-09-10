import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { MemoryService } from "../memory/service.js";
import { ResultFormat } from "../memory/format.js";
import type { ContextSession } from "../session.js";
import { SyncEngine } from "../sync/engine.js";

export const CLIENT_INSTRUCTIONS = `Shared local memory for this machine. Use it to keep Claude Code, Cursor, and Augment Code aligned.

Behavior:
- Before meaningful work, call get_project_context (or get_current_work) for the repo you are in.
- Save discoveries and decisions only when they are reusable (gotchas, constraints, choices). Do not record every tool call or trivial edit.
- Update current work only after meaningful progress.
- Update stand-up only after meaningful progress. One sentence per work item. Stand-up is GLOBAL across repos.
- Never store secrets, tokens, or credentials. This server redacts common secret patterns but you must not paste them.
- Scope repository context to the correct projectId. If cwd is registered via repo path, you may omit projectId.`;

const projectRef = {
  projectId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .optional()
    .describe("Project slug, e.g. issuer-ui"),
  cwd: z.string().optional().describe("Working directory used to match a registered repo path"),
};

const source = z
  .enum(["claude-code", "cursor", "augment", "cli", "markdown", "unknown"])
  .optional()
  .describe("Which agent or tool is writing");

export class SharedContextServer {
  static create(session: ContextSession): McpServer {
    const server = new McpServer(
      {
        name: "shared-context",
        version: "1.0.0",
      },
      {
        instructions: CLIENT_INSTRUCTIONS,
        capabilities: { tools: {} },
      },
    );

    server.registerTool(
      "add_project",
      {
        title: "Add project",
        description: "Register or update a project so cwd/repo matching and other tools can resolve it.",
        inputSchema: z.object({
          projectId: z
            .string()
            .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
            .describe("Project slug, e.g. issuer-ui"),
          name: z.string().min(1).max(200).optional(),
          repoPath: z.string().optional().describe("Local repo path used to auto-scope tools from cwd"),
        }),
      },
      async ({ projectId, name, repoPath }) =>
        SharedContextServer.guard(async () => {
          const result = MemoryService.addProject(session, { id: projectId, name, repoPath });
          await SyncEngine.exportAll(session);
          return `${result.created ? "added" : "updated"} ${result.id} (${result.name})`;
        }),
    );

    server.registerTool(
      "get_project_context",
      {
        title: "Get project context",
        description:
          "Read current work, stand-up line, and recent discoveries/decisions for a project. Call before meaningful work.",
        inputSchema: z.object(projectRef),
      },
      async ({ projectId, cwd }) =>
        SharedContextServer.guard(() => {
          const ctx = MemoryService.getProjectContext(session, projectId, cwd);
          return ResultFormat.projectContext(ctx);
        }),
    );

    server.registerTool(
      "get_current_work",
      {
        title: "Get current work",
        description: "Read the current-work note for a project.",
        inputSchema: z.object(projectRef),
      },
      async ({ projectId, cwd }) =>
        SharedContextServer.guard(() => {
          const ctx = MemoryService.getCurrentWork(session, projectId, cwd);
          return ResultFormat.currentWork(ctx.project, ctx.currentWork);
        }),
    );

    server.registerTool(
      "save_discovery",
      {
        title: "Save discovery",
        description:
          "Store a reusable discovery (gotcha, constraint, finding). Skips near-duplicates. Do not log trivia.",
        inputSchema: z.object({
          ...projectRef,
          title: z.string().min(1).max(200),
          body: z.string().min(1).max(8000),
          source,
        }),
      },
      async (input) =>
        SharedContextServer.guard(async () => {
          const result = await MemoryService.saveDiscovery(session, input);
          return ResultFormat.saved(result);
        }),
    );

    server.registerTool(
      "save_decision",
      {
        title: "Save decision",
        description: "Store a team/agent decision and why. Skips near-duplicates. Do not log trivia.",
        inputSchema: z.object({
          ...projectRef,
          title: z.string().min(1).max(200),
          body: z.string().min(1).max(8000),
          source,
        }),
      },
      async (input) =>
        SharedContextServer.guard(async () => {
          const result = await MemoryService.saveDecision(session, input);
          return ResultFormat.saved(result);
        }),
    );

    server.registerTool(
      "update_current_work",
      {
        title: "Update current work",
        description:
          "Replace the current-work note after meaningful progress. Does not delete discoveries or decisions.",
        inputSchema: z.object({
          ...projectRef,
          body: z.string().min(1).max(8000),
          source,
        }),
      },
      async (input) =>
        SharedContextServer.guard(async () => {
          const result = await MemoryService.updateCurrentWork(session, input);
          return ResultFormat.currentWork(MemoryService.getCurrentWork(session, result.projectId).project, result.body);
        }),
    );

    server.registerTool(
      "search_memory",
      {
        title: "Search memory",
        description:
          "Full-text search across discoveries, decisions, and current work. Optional semantic re-rank if OpenAI is configured.",
        inputSchema: z.object({
          query: z.string().min(1).max(200),
          projectId: projectRef.projectId,
          kind: z.enum(["discovery", "decision", "current_work"]).optional(),
          limit: z.number().int().min(1).max(25).optional(),
        }),
      },
      async (input) =>
        SharedContextServer.guard(async () => {
          const rows = await MemoryService.search(session, input);
          return ResultFormat.search(rows);
        }),
    );

    server.registerTool(
      "get_standup",
      {
        title: "Get stand-up",
        description: "Read the global stand-up (one sentence per work item, across all repos).",
        inputSchema: z.object({}),
      },
      async () => SharedContextServer.guard(() => ResultFormat.standup(MemoryService.getStandup(session))),
    );

    server.registerTool(
      "update_standup",
      {
        title: "Update stand-up",
        description:
          "Update the global stand-up. One sentence per work item. Set generate=true to derive sentences from current work.",
        inputSchema: z.object({
          projectId: projectRef.projectId,
          sentence: z.string().min(1).max(280).optional(),
          items: z
            .array(
              z.object({
                projectId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
                sentence: z.string().min(1).max(280),
              }),
            )
            .optional(),
          generate: z.boolean().optional(),
        }),
      },
      async (input) =>
        SharedContextServer.guard(async () => {
          const items = await MemoryService.updateStandup(session, input);
          return ResultFormat.standup(items);
        }),
    );

    return server;
  }

  static async guard(fn: () => string | Promise<string>) {
    try {
      const text = await fn();
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[shared-context] tool error: ${text}\n`);
      return { content: [{ type: "text" as const, text }], isError: true };
    }
  }
}
