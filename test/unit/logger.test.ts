import { afterEach, describe, it } from "node:test";
import { Logger } from "../../src/logging/logger.js";
import { MemoryService } from "../../src/memory/service.js";
import type { ContextSession } from "../../src/session.js";
import { expect } from "../expect.js";
import { openSession } from "../helpers.js";

describe("Logger", () => {
  let session: ContextSession;

  afterEach(() => {
    session?.close();
  });

  it("prunes operation_logs down to MAX_ROWS", () => {
    ({ session } = openSession());
    MemoryService.addProject(session, { id: "issuer-ui" });
    const prev = Logger.MAX_ROWS;
    Logger.MAX_ROWS = 5;
    try {
      for (let i = 0; i < 12; i += 1) {
        Logger.info(session, "prune-test", String(i));
      }
      const count = session.sqlite.prepare("SELECT count(*) AS c FROM operation_logs").get() as { c: number };
      expect(count.c).toBe(5);
    } finally {
      Logger.MAX_ROWS = prev;
    }
  });
});
