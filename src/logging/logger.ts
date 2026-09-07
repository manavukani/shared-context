import { operationLogs } from "../db/schema.js";
import type { ContextSession } from "../session.js";
import { SecretRedactor } from "../secrets.js";

export class Logger {
  static info(
    session: ContextSession,
    operation: string,
    detail: string,
    projectId?: string,
  ): void {
    const safe = SecretRedactor.redact(detail).slice(0, 500);
    process.stderr.write(`[shared-context] ${operation}${projectId ? ` ${projectId}` : ""} ${safe}\n`);
    session.db.insert(operationLogs).values({
      operation,
      projectId: projectId ?? null,
      detail: safe,
      createdAt: Date.now(),
    }).run();
  }
}
