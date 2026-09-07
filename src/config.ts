import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type AiConfig = {
  enabled: boolean;
  model: string;
  embeddingModel: string;
};

export type AppConfigData = {
  version: 1;
  ai: AiConfig;
};

const DEFAULT_CONFIG: AppConfigData = {
  version: 1,
  ai: {
    enabled: true,
    model: "gpt-4o-mini",
    embeddingModel: "text-embedding-3-small",
  },
};

export class AppConfig {
  constructor(
    readonly path: string,
    readonly data: AppConfigData,
  ) {}

  static defaults(): AppConfigData {
    return structuredClone(DEFAULT_CONFIG);
  }

  static load(path: string): AppConfig {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<AppConfigData>;
      const data: AppConfigData = {
        version: 1,
        ai: {
          enabled: parsed.ai?.enabled ?? true,
          model: parsed.ai?.model ?? DEFAULT_CONFIG.ai.model,
          embeddingModel: parsed.ai?.embeddingModel ?? DEFAULT_CONFIG.ai.embeddingModel,
        },
      };
      return new AppConfig(path, data);
    } catch {
      return new AppConfig(path, AppConfig.defaults());
    }
  }

  static write(path: string, data: AppConfigData = AppConfig.defaults()): AppConfig {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return new AppConfig(path, data);
  }

  get aiEnabled(): boolean {
    return this.data.ai.enabled === true;
  }
}
