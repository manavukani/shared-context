import { afterEach, describe, it } from "node:test";
import { OpenAiLayer } from "../../src/ai/openai.js";
import { MemoryService } from "../../src/memory/service.js";
import { ResultFormat } from "../../src/memory/format.js";
import type { ContextSession } from "../../src/session.js";
import { expect } from "../expect.js";
import { openSession } from "../helpers.js";

describe("MemoryService", () => {
  let session: ContextSession;

  afterEach(() => {
    session?.close();
  });

  it("saves, retrieves, and deduplicates project memories", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui", name: "Issuer UI" });

    const discovery = await MemoryService.saveDiscovery(session, {
      projectId: "issuer-ui",
      title: "PKCE required",
      body: "Public clients must use PKCE on the token endpoint.",
      source: "claude-code",
    });
    expect(discovery.saved).toBe(true);

    const again = await MemoryService.saveDiscovery(session, {
      projectId: "issuer-ui",
      title: "PKCE required",
      body: "Public clients must use PKCE on the token endpoint.",
      source: "cursor",
    });
    expect(again.duplicate).toBe(true);
    expect(again.memory.id).toBe(discovery.memory.id);

    const decision = await MemoryService.saveDecision(session, {
      projectId: "issuer-ui",
      title: "Use auth code + PKCE",
      body: "Skip implicit flow; auth code with PKCE only.",
      source: "augment",
    });
    expect(decision.saved).toBe(true);

    await MemoryService.updateCurrentWork(session, {
      projectId: "issuer-ui",
      body: "Implementing the OAuth callback page.",
      source: "cursor",
    });

    const ctx = MemoryService.getProjectContext(session, "issuer-ui");
    expect(ctx.discoveries).toHaveLength(1);
    expect(ctx.decisions).toHaveLength(1);
    expect(ctx.currentWork).toContain("OAuth callback");

    const hits = await MemoryService.search(session, { query: "PKCE" });
    expect(hits.some((hit) => hit.title.includes("PKCE"))).toBe(true);

    const standup = await MemoryService.updateStandup(session, { generate: true });
    expect(standup).toHaveLength(1);
    expect(standup[0]?.sentence.length).toBeGreaterThan(0);
    expect(standup[0]?.sentence.includes("\n")).toBe(false);

    const formatted = ResultFormat.projectContext(ctx);
    expect(formatted).toContain("issuer-ui");
    expect(formatted).toContain("PKCE");
  });

  it("redacts secrets and never stores them", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    const result = await MemoryService.saveDiscovery(session, {
      projectId: "issuer-ui",
      title: "Token leak",
      body: "Do not commit sk-abcdefghijklmnopqrstuvwxyz123456 in .env",
      source: "cli",
    });
    expect(result.memory.body).toContain("[REDACTED]");
    expect(result.memory.body).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });

  it("keeps stand-up global and one sentence per project", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    MemoryService.addProject(session, { id: "billing-api" });
    await MemoryService.updateStandup(session, {
      items: [
        { projectId: "issuer-ui", sentence: "Shipping OAuth refresh. Extra sentence should be dropped!" },
        { projectId: "billing-api", sentence: "Investigating invoice retries." },
      ],
    });
    const items = MemoryService.getStandup(session);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.projectId === "issuer-ui")?.sentence).toBe("Shipping OAuth refresh.");
  });

  it("scopes cwd to the registered repo path", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui", repoPath: "/tmp/work/issuer-ui" });
    MemoryService.addProject(session, { id: "other", repoPath: "/tmp/work/other" });
    const id = MemoryService.resolveProjectId(session, undefined, "/tmp/work/issuer-ui/src");
    expect(id).toBe("issuer-ui");
  });

  it("edits and deletes memories and can remove a project", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    const saved = await MemoryService.saveDiscovery(session, {
      projectId: "issuer-ui",
      title: "Old title",
      body: "Old body that will change.",
      source: "cli",
    });
    const edited = await MemoryService.editMemory(session, {
      id: saved.memory.id,
      title: "New title",
      body: "New body after the edit.",
    });
    expect(edited.title).toBe("New title");
    expect(edited.body).toBe("New body after the edit.");
    await MemoryService.deleteMemory(session, saved.memory.id);
    const hits = await MemoryService.search(session, { query: "New body", projectId: "issuer-ui" });
    expect(hits).toHaveLength(0);
    await MemoryService.updateCurrentWork(session, { projectId: "issuer-ui", body: "WIP" });
    await MemoryService.clearCurrentWork(session, "issuer-ui");
    expect(MemoryService.getCurrentWork(session, "issuer-ui").currentWork).toBe("");
    await MemoryService.removeProject(session, "issuer-ui");
    expect(MemoryService.listProjects(session)).toHaveLength(0);
  });

  it("includes AI errors on doctor output", async () => {
    ({ session } = openSession());
    OpenAiLayer.lastError = "[shared-context] openai /chat/completions HTTP 401";
    const health = await MemoryService.doctor(session);
    expect(health.healthy).toBe(true);
    expect(health.ai).toBe("degraded");
    expect(health.aiError).toContain("HTTP 401");
    OpenAiLayer.lastError = null;
  });

  it("does not sink un-embedded FTS hits when re-ranking", () => {
    expect(MemoryService.blendedScore(0, null)).toBeGreaterThan(MemoryService.blendedScore(5, 0));
    expect(MemoryService.blendedScore(0, null)).toBeGreaterThan(MemoryService.blendedScore(0, 0));
  });

  it("embeds a memory only once when AI is enabled", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    const prevKey = process.env.OPENAI_API_KEY;
    const prevFetch = OpenAiLayer.fetchFn;
    process.env.OPENAI_API_KEY = "sk-test";
    let embeds = 0;
    OpenAiLayer.fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/embeddings")) {
        embeds += 1;
        return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "discovery" } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      await MemoryService.saveDiscovery(session, {
        projectId: "issuer-ui",
        title: "Once",
        body: "Embed this text a single time.",
        source: "cli",
      });
      expect(embeds).toBe(1);
    } finally {
      OpenAiLayer.fetchFn = prevFetch;
      if (prevKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = prevKey;
      }
    }
  });
});
