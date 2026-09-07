export type MemoryKind = "discovery" | "decision";

export type MemorySection = {
  id: string;
  title: string;
  body: string;
  createdAt?: number;
  source?: string;
};

export class MarkdownCodec {
  static currentWork(body: string): string {
    const trimmed = body.trim();
    return `# Current work\n\n${trimmed}\n`;
  }

  static parseCurrentWork(markdown: string): string {
    return markdown.replace(/^#\s*Current work\s*/i, "").trim();
  }

  static standup(items: { projectId: string; sentence: string }[]): string {
    const lines = items.map((item) => `- **${item.projectId}**: ${item.sentence.trim()}`);
    return `# Stand-up\n\n${lines.length > 0 ? `${lines.join("\n")}\n` : "_No items._\n"}`;
  }

  static parseStandup(markdown: string): { projectId: string; sentence: string }[] {
    const items: { projectId: string; sentence: string }[] = [];
    for (const line of markdown.split(/\r?\n/)) {
      const match = line.match(/^\s*-\s+\*\*([a-z0-9][a-z0-9-]*)\*\*:\s*(.+)$/i);
      if (match) {
        items.push({ projectId: match[1]!.toLowerCase(), sentence: match[2]!.trim() });
      }
    }
    return items;
  }

  static memories(kind: MemoryKind, sections: MemorySection[]): string {
    const heading = kind === "discovery" ? "Discoveries" : "Decisions";
    if (sections.length === 0) {
      return `# ${heading}\n\n_None yet._\n`;
    }
    const blocks = sections.map((section) => {
      const meta = [
        `id: ${section.id}`,
        section.createdAt ? `created: ${new Date(section.createdAt).toISOString()}` : null,
        section.source ? `source: ${section.source}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      return `## ${section.title}\n\n<!-- ${meta} -->\n\n${section.body.trim()}\n`;
    });
    return `# ${heading}\n\n${blocks.join("\n")}`;
  }

  static parseMemories(markdown: string): MemorySection[] {
    const withoutTitle = markdown.replace(/^#\s*(Discoveries|Decisions)\s*/i, "");
    if (/^\s*_None yet\._/i.test(withoutTitle)) {
      return [];
    }
    const chunks = withoutTitle.split(/^## /m).map((chunk) => chunk.trim()).filter(Boolean);
    const sections: MemorySection[] = [];
    for (const chunk of chunks) {
      const lines = chunk.split(/\r?\n/);
      const title = lines.shift()?.trim() ?? "Untitled";
      const rest = lines.join("\n").trim();
      const metaMatch = rest.match(/<!--\s*(.*?)\s*-->/);
      const body = rest.replace(/<!--\s*.*?\s*-->/, "").trim();
      const idMatch = metaMatch?.[1]?.match(/id:\s*([0-9a-f-]{8,})/i);
      const createdMatch = metaMatch?.[1]?.match(/created:\s*(\S+)/);
      const sourceMatch = metaMatch?.[1]?.match(/source:\s*([a-z0-9-]+)/i);
      const createdAt = createdMatch ? Date.parse(createdMatch[1]!) : undefined;
      sections.push({
        id: idMatch?.[1] ?? crypto.randomUUID(),
        title,
        body,
        createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
        source: sourceMatch?.[1],
      });
    }
    return sections;
  }
}
