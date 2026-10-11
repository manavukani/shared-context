import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextSession } from "../src/session.js";

export function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "shared-context-"));
}

export function openSession(): { home: string; session: ContextSession } {
  const home = tempHome();
  const session = ContextSession.open(home);
  return { home, session };
}
