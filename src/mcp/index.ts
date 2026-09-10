#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { EnvFile } from "../env.js";
import { ContextSession } from "../session.js";
import { SyncEngine } from "../sync/engine.js";
import { SharedContextServer } from "./server.js";

EnvFile.load();

function createServer() {
  const session = ContextSession.open();
  void SyncEngine.importThenExport(session).catch((error) => {
    process.stderr.write(`[shared-context] startup sync failed: ${String(error)}\n`);
  });
  process.stderr.write(`[shared-context] MCP stdio server home=${session.paths.home}\n`);
  return SharedContextServer.create(session);
}

void serveStdio(createServer);
