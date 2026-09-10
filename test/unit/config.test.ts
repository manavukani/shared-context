import { describe, it } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppConfig } from "../../src/config.js";
import { MemoryService } from "../../src/memory/service.js";
import { ContextSession } from "../../src/session.js";
import { expect } from "../expect.js";
import { tempHome } from "../helpers.js";

describe("AppConfig", () => {
  it("treats malformed config as an error instead of silent defaults", async () => {
    const home = tempHome();
    const session = ContextSession.open(home);
    writeFileSync(session.paths.configFile, "{ this is not json\n");
    session.close();
    const broken = ContextSession.open(home);
    expect(Boolean(broken.config.error)).toBe(true);
    const health = await MemoryService.doctor(broken);
    expect(health.healthy).toBe(false);
    expect(health.configError).toContain("JSON");
    broken.close();
  });
});
