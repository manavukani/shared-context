import { operationLogs } from "../db/schema.js";
import type { ContextSession } from "../session.js";
import { SecretRedactor } from "../secrets.js";

export class Logger {
  static MAX_ROWS = 1000;

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
    Logger.prune(session);
  }

  static prune(session: ContextSession, keep = Logger.MAX_ROWS): void {
    const count = session.sqlite.prepare("SELECT count(*) AS c FROM operation_logs").get() as { c: number };
    if (count.c <= keep) {
      return;
    }
    session.sqlite
      .prepare(
        "DELETE FROM operation_logs WHERE id IN (SELECT id FROM operation_logs ORDER BY id ASC LIMIT ?)",
      )
      .run(count.c - keep);
  }
}
