import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "../expect.js";
import { tempHome } from "../helpers.js";

const cli = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));

function run(home: string, args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", cli, "--home", home, ...args], {
    encoding: "utf8",
    env: { ...process.env, AI_CONTEXT_HOME: home },
  });
}

describe("CLI", () => {
  it("inits, registers a project, saves memory, and reports doctor healthy", () => {
    const home = tempHome();
    const init = run(home, ["init"]);
    expect(init).toContain("Initialized");
    expect(run(home, ["project", "add", "issuer-ui", "--name", "Issuer UI"])).toContain("added issuer-ui");
    expect(run(home, ["project", "list"])).toContain("issuer-ui");
    const saved = run(home, [
      "memory",
      "save",
      "--kind",
      "discovery",
      "--project",
      "issuer-ui",
      "--title",
      "Callback URL",
      "--body",
      "Must match the registered redirect URI.",
      "--source",
      "claude-code",
    ]);
    expect(saved).toContain("saved:");
    expect(run(home, ["memory", "search", "redirect"])).toContain("Callback URL");
    run(home, ["standup", "update", "--project", "issuer-ui", "--sentence", "Wiring the OAuth callback."]);
    expect(run(home, ["standup", "show"])).toContain("issuer-ui");
    expect(run(home, ["sync"])).toContain("sync ok");
    const doctor = run(home, ["doctor"]);
    expect(doctor).toContain('"healthy": true');
    expect(existsSync(`${home}/projects/issuer-ui/discoveries.md`)).toBe(true);
    expect(readFileSync(`${home}/projects/issuer-ui/discoveries.md`, "utf8")).toContain("Callback URL");
  });
});
