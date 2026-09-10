import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export class EnvFile {
  static load(dir = process.cwd()): Record<string, string> {
    const file = resolve(dir, ".env");
    if (!existsSync(file)) {
      return {};
    }
    const applied: Record<string, string> = {};
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const eq = line.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
        applied[key] = value;
      }
    }
    return applied;
  }
}
