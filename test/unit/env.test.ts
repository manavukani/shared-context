import { describe, it } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EnvFile } from "../../src/env.js";
import { ContextPaths } from "../../src/paths.js";
import { expect } from "../expect.js";
import { tempHome } from "../helpers.js";

describe("EnvFile", () => {
  it("loads unset keys from a .env file without overriding existing env", () => {
    const dir = tempHome();
    writeFileSync(join(dir, ".env"), "AI_CONTEXT_ENV_TEST_KEY=from-file\nAI_CONTEXT_ENV_KEEP=file-value\n");
    process.env.AI_CONTEXT_ENV_KEEP = "already-set";
    delete process.env.AI_CONTEXT_ENV_TEST_KEY;
    const applied = EnvFile.load(dir);
    expect(applied.AI_CONTEXT_ENV_TEST_KEY).toBe("from-file");
    expect(process.env.AI_CONTEXT_ENV_TEST_KEY).toBe("from-file");
    expect(process.env.AI_CONTEXT_ENV_KEEP).toBe("already-set");
    delete process.env.AI_CONTEXT_ENV_TEST_KEY;
    delete process.env.AI_CONTEXT_ENV_KEEP;
  });
});

describe("ContextPaths", () => {
  it("uses AI_CONTEXT_HOME and AI_CONTEXT_DB when set", () => {
    const home = tempHome();
    const db = join(home, "custom.sqlite");
    const prevDb = process.env.AI_CONTEXT_DB;
    process.env.AI_CONTEXT_DB = db;
    try {
      const paths = ContextPaths.resolve(home);
      expect(paths.home).toBe(home);
      expect(paths.sqlitePath).toBe(db);
      expect(paths.configFile).toBe(join(home, "config.json"));
    } finally {
      if (prevDb === undefined) {
        delete process.env.AI_CONTEXT_DB;
      } else {
        process.env.AI_CONTEXT_DB = prevDb;
      }
    }
  });

  it("defaults sqlite under home/db when AI_CONTEXT_DB is unset", () => {
    const home = tempHome();
    const prevDb = process.env.AI_CONTEXT_DB;
    delete process.env.AI_CONTEXT_DB;
    try {
      expect(ContextPaths.resolve(home).sqlitePath).toBe(join(home, "db", "context.sqlite"));
    } finally {
      if (prevDb !== undefined) {
        process.env.AI_CONTEXT_DB = prevDb;
      }
    }
  });

  it("defaults home to ~/.ai-context outside iCloud Documents", () => {
    const prev = process.env.AI_CONTEXT_HOME;
    delete process.env.AI_CONTEXT_HOME;
    try {
      const home = ContextPaths.resolve().home;
      expect(home.endsWith(".ai-context")).toBe(true);
      expect(home.includes(`${join("Documents", "ai-context")}`)).toBe(false);
    } finally {
      if (prev !== undefined) {
        process.env.AI_CONTEXT_HOME = prev;
      }
    }
  });
});
