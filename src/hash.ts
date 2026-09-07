import { createHash } from "node:crypto";

export class ContentHash {
  static normalize(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }

  static of(kind: string, title: string, body: string): string {
    const payload = `${kind}\n${ContentHash.normalize(title)}\n${ContentHash.normalize(body)}`;
    return createHash("sha256").update(payload).digest("hex");
  }

  static bytes(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }
}
