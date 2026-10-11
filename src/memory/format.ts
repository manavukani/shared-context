import type { MemoryRow, ProjectRow, StandupItemRow } from "../db/schema.js";

export class ResultFormat {
  static projectContext(input: {
    project: ProjectRow;
    currentWork: string;
    standup: string;
    discoveries: MemoryRow[];
    decisions: MemoryRow[];
  }): string {
    const lines = [
      `# ${input.project.id} — ${input.project.name}`,
      input.project.repoPath ? `repo: ${input.project.repoPath}` : null,
      "",
      "## Current work",
      input.currentWork || "_none_",
      "",
      "## Stand-up",
      input.standup || "_none_",
      "",
      "## Discoveries",
      ...ResultFormat.memoryBullets(input.discoveries),
      "",
      "## Decisions",
      ...ResultFormat.memoryBullets(input.decisions),
    ];
    return (
      lines
        .filter((line) => line !== null)
        .join("\n")
        .trim() + "\n"
    );
  }

  static currentWork(project: ProjectRow, body: string): string {
    return `# ${project.id} current work\n\n${body || "_none_"}\n`;
  }

  static saved(result: { saved: boolean; duplicate: boolean; memory: MemoryRow }): string {
    const tag = result.duplicate ? "duplicate (not stored again)" : "saved";
    return `${tag}: [${result.memory.kind}] ${result.memory.title} (${result.memory.id})\n${result.memory.body}\n`;
  }

  static deleted(id: string): string {
    return `deleted: ${id}\n`;
  }

  static removedProject(id: string): string {
    return `removed ${id}\n`;
  }

  static search(rows: { id: string; projectId: string; kind: string; title: string; excerpt: string }[]): string {
    if (rows.length === 0) {
      return "No matches.\n";
    }
    return (
      rows.map((row) => `- [${row.kind}] ${row.projectId} / ${row.title}\n  ${row.excerpt} (${row.id})`).join("\n") +
      "\n"
    );
  }

  static standup(items: StandupItemRow[]): string {
    if (items.length === 0) {
      return "Stand-up is empty.\n";
    }
    return items.map((item) => `- ${item.projectId}: ${item.sentence}`).join("\n") + "\n";
  }

  private static memoryBullets(rows: MemoryRow[]): string[] {
    if (rows.length === 0) {
      return ["_none_"];
    }
    return rows.map((row) => `- ${row.title}: ${row.body.replace(/\s+/g, " ").slice(0, 160)}`);
  }
}
