import { homedir } from "node:os";
import { join } from "node:path";

export class ContextPaths {
  readonly home: string;

  constructor(home: string) {
    this.home = home;
  }

  static resolve(homeOverride?: string): ContextPaths {
    const home =
      homeOverride ??
      process.env.AI_CONTEXT_HOME ??
      join(homedir(), "Documents", "ai-context");
    return new ContextPaths(home);
  }

  get configFile(): string {
    return join(this.home, "config.json");
  }

  get standupFile(): string {
    return join(this.home, "standup.md");
  }

  get dbDir(): string {
    return join(this.home, "db");
  }

  get sqlitePath(): string {
    return join(this.dbDir, "context.sqlite");
  }

  get projectsDir(): string {
    return join(this.home, "projects");
  }

  projectDir(projectId: string): string {
    return join(this.projectsDir, projectId);
  }

  currentWorkFile(projectId: string): string {
    return join(this.projectDir(projectId), "current-work.md");
  }

  discoveriesFile(projectId: string): string {
    return join(this.projectDir(projectId), "discoveries.md");
  }

  decisionsFile(projectId: string): string {
    return join(this.projectDir(projectId), "decisions.md");
  }
}
