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

  it("deletes memories and removes projects", () => {
    const home = tempHome();
    run(home, ["init"]);
    run(home, ["project", "add", "issuer-ui"]);
    const saved = run(home, [
      "memory",
      "save",
      "--kind",
      "discovery",
      "--project",
      "issuer-ui",
      "--title",
      "Temp",
      "--body",
      "Will be deleted.",
    ]);
    const id = saved.match(/\(([0-9a-f-]{36})\)/)?.[1];
    expect(Boolean(id)).toBe(true);
    const edited = run(home, ["memory", "edit", "--id", id!, "--title", "Renamed"]);
    expect(edited).toContain("Renamed");
    expect(run(home, ["memory", "delete", "--id", id!])).toContain("deleted:");
    expect(run(home, ["project", "remove", "issuer-ui"])).toContain("removed issuer-ui");
    expect(run(home, ["project", "list"])).toContain("No projects");
  });

  it("saves with --cwd auto-detect and honors --limit on search", () => {
    const home = tempHome();
    const repo = `${home}/repo`;
    run(home, ["init"]);
    run(home, ["project", "add", "issuer-ui", "--repo", repo]);
    const saved = run(home, [
      "memory",
      "save",
      "--kind",
      "discovery",
      "--cwd",
      repo,
      "--title",
      "From cwd",
      "--body",
      "Resolved via repo path.",
    ]);
    expect(saved).toContain("saved:");
    run(home, [
      "memory",
      "save",
      "--kind",
      "discovery",
      "--project",
      "issuer-ui",
      "--title",
      "Second hit",
      "--body",
      "Another Resolved note.",
    ]);
    const limited = run(home, ["memory", "search", "Resolved", "--limit", "1"]);
    const hits = limited.trim().split("\n").filter((line) => line.startsWith("- "));
    expect(hits).toHaveLength(1);
  });

  it("exits nonzero when standup update has --project but no --sentence", () => {
    const home = tempHome();
    run(home, ["init"]);
    run(home, ["project", "add", "issuer-ui"]);
    let failed = false;
    try {
      run(home, ["standup", "update", "--project", "issuer-ui"]);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
