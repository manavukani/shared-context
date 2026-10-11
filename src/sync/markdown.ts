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
    const headerRe = /^## (.+)\r?\n(?:\r?\n)?<!--\s*(id:\s*[0-9a-f-]{8,}.*?)\s*-->/gim;
    const headers = [...withoutTitle.matchAll(headerRe)];
    if (headers.length === 0) {
      return [];
    }
    const sections: MemorySection[] = [];
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i]!;
      const title = header[1]!.trim() || "Untitled";
      const meta = header[2] ?? "";
      const bodyStart = (header.index ?? 0) + header[0].length;
      const bodyEnd = i + 1 < headers.length ? (headers[i + 1]!.index ?? withoutTitle.length) : withoutTitle.length;
      const body = withoutTitle.slice(bodyStart, bodyEnd).trim();
      const idMatch = meta.match(/id:\s*([0-9a-f-]{8,})/i);
      const createdMatch = meta.match(/created:\s*(\S+)/);
      const sourceMatch = meta.match(/source:\s*([a-z0-9-]+)/i);
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
