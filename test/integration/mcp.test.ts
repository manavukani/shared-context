import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { CLIENT_INSTRUCTIONS, SharedContextServer } from "../../src/mcp/server.js";
import { MemoryService } from "../../src/memory/service.js";
import type { ContextSession } from "../../src/session.js";
import { expect } from "../expect.js";
import { openSession } from "../helpers.js";

async function connectClient(session: ContextSession) {
  const server = SharedContextServer.create(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "shared-context-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((block) => ("text" in block ? block.text : "")).join("\n");
}

describe("MCP tools", () => {
  let session: ContextSession;
  let client: Client;

  afterEach(async () => {
    await client?.close();
    session?.close();
  });

  it("registers the v1 tool surface and serves the client workflow", async () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui", name: "Issuer UI" });
    ({ client } = await connectClient(session));

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        "add_project",
        "get_current_work",
        "get_project_context",
        "get_standup",
        "save_decision",
        "save_discovery",
        "search_memory",
        "update_current_work",
        "update_standup",
      ].sort(),
    );
    expect(CLIENT_INSTRUCTIONS).toContain("Before meaningful work");

    const discovery = await client.callTool({
      name: "save_discovery",
      arguments: {
        projectId: "issuer-ui",
        title: "State param is required",
        body: "OAuth authorize requests must include state to prevent CSRF.",
        source: "claude-code",
      },
    });
    expect(textOf(discovery)).toContain("saved:");

    const fromCursor = await client.callTool({
      name: "search_memory",
      arguments: { query: "CSRF", projectId: "issuer-ui" },
    });
    expect(textOf(fromCursor)).toContain("State param");

    const decision = await client.callTool({
      name: "save_decision",
      arguments: {
        projectId: "issuer-ui",
        title: "PKCE S256 only",
        body: "Reject plain PKCE; require S256.",
        source: "augment",
      },
    });
    expect(textOf(decision)).toContain("saved:");

    const retrieved = await client.callTool({
      name: "get_project_context",
      arguments: { projectId: "issuer-ui" },
    });
    expect(textOf(retrieved)).toContain("PKCE S256");

    await client.callTool({
      name: "update_current_work",
      arguments: {
        projectId: "issuer-ui",
        body: "Adding the authorize state round-trip.",
        source: "cursor",
      },
    });
    await client.callTool({
      name: "update_standup",
      arguments: { generate: true },
    });
    const standup = await client.callTool({ name: "get_standup", arguments: {} });
    expect(textOf(standup)).toContain("issuer-ui");
  });

  it("registers a project through add_project", async () => {
    ({ session } = openSession());
    ({ client } = await connectClient(session));
    const added = await client.callTool({
      name: "add_project",
      arguments: { projectId: "issuer-ui", name: "Issuer UI", repoPath: "/tmp/work/issuer-ui" },
    });
    expect(textOf(added)).toContain("added issuer-ui");
    const ctx = await client.callTool({
      name: "get_project_context",
      arguments: { projectId: "issuer-ui" },
    });
    expect(textOf(ctx)).toContain("Issuer UI");
  });

  it("validates inputs before mutating", async () => {
    ({ session } = openSession());
    ({ client } = await connectClient(session));
    const result = await client.callTool({
      name: "save_discovery",
      arguments: { title: "", body: "x" },
    });
    const text = textOf(result).toLowerCase();
    expect(result.isError === true || text.includes("invalid") || text.includes("required")).toBe(true);
  });
});
