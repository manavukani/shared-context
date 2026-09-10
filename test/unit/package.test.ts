import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { expect } from "../expect.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  bin: Record<string, string>;
  scripts: Record<string, string>;
};

describe("package.json publish surface", () => {
  it("builds dist on install and before publish", () => {
    expect(pkg.scripts.prepare).toBe("npm run build");
    expect(pkg.scripts.prepublishOnly).toBe("npm run build");
  });

  it("exposes both the CLI and MCP server bins", () => {
    expect(pkg.bin.context).toBe("./dist/cli/index.js");
    expect(pkg.bin["shared-context-mcp"]).toBe("./dist/mcp/index.js");
  });
});
