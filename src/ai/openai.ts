import type { AppConfig } from "../config.js";

export type AiStatus = "off" | "ready" | "degraded";

type ChatResponse = {
  choices?: { message?: { content?: string | null } }[];
};

type EmbeddingResponse = {
  data?: { embedding: number[] }[];
};

export class OpenAiLayer {
  static lastError: string | null = null;
  static fetchFn: typeof fetch = globalThis.fetch.bind(globalThis);

  private readonly apiKey: string | undefined;
  private readonly fetchFn: typeof fetch;
  readonly status: AiStatus;
  readonly model: string;
  readonly embeddingModel: string;
  readonly baseUrl: string;

  constructor(config: AppConfig, apiKey = process.env.OPENAI_API_KEY, fetchFn?: typeof fetch) {
    this.model = config.data.ai.model;
    this.embeddingModel = config.data.ai.embeddingModel;
    this.baseUrl = (
      process.env.OPENAI_BASE_URL ||
      process.env.AI_CONTEXT_OPENAI_BASE_URL ||
      config.data.ai.baseUrl ||
      "https://api.openai.com/v1"
    ).replace(/\/$/, "");
    this.apiKey = apiKey || undefined;
    this.fetchFn = fetchFn ?? OpenAiLayer.fetchFn;
    if (!config.aiEnabled) {
      this.status = "off";
      return;
    }
    this.status = this.apiKey ? "ready" : "degraded";
  }

  get enabled(): boolean {
    return this.status === "ready";
  }

  static cosine(a: number[], b: number[]): number {
    if (a.length === 0 || a.length !== b.length) {
      return 0;
    }
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  static parseEmbedding(raw: string | null): number[] | null {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== "number")) {
        return null;
      }
      return parsed as number[];
    } catch {
      return null;
    }
  }

  async embed(text: string): Promise<number[] | null> {
    const json = await this.post<EmbeddingResponse>("/embeddings", {
      model: this.embeddingModel,
      input: text.slice(0, 8000),
    });
    return json?.data?.[0]?.embedding ?? null;
  }

  async summarize(text: string, instruction: string): Promise<string | null> {
    const json = await this.post<ChatResponse>("/chat/completions", {
      model: this.model,
      temperature: 0.2,
      max_completion_tokens: 120,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: text.slice(0, 4000) },
      ],
    });
    return json?.choices?.[0]?.message?.content?.trim() || null;
  }

  async classifyKind(title: string, body: string): Promise<"discovery" | "decision" | null> {
    const json = await this.post<ChatResponse>("/chat/completions", {
      model: this.model,
      temperature: 0,
      max_completion_tokens: 10,
      messages: [
        {
          role: "system",
          content:
            'Reply with only "discovery" or "decision". A discovery is something learned. A decision is a choice the team made.',
        },
        { role: "user", content: `${title}\n\n${body}`.slice(0, 2000) },
      ],
    });
    const text = json?.choices?.[0]?.message?.content?.trim().toLowerCase();
    if (text === "discovery" || text === "decision") {
      return text;
    }
    return null;
  }

  async oneSentence(text: string): Promise<string | null> {
    return this.summarize(
      text,
      "Rewrite as a single stand-up sentence (max 20 words). No preamble. Present tense.",
    );
  }

  async probe(): Promise<boolean> {
    if (this.status === "off") {
      return true;
    }
    if (!this.apiKey) {
      return false;
    }
    const json = await this.post<{ data?: unknown }>("/models", undefined, "GET");
    return json != null;
  }

  private static readonly timeoutMs = 10_000;
  private static readonly retries = 2;

  private async post<T>(path: string, body: unknown, method = "POST"): Promise<T | null> {
    if (!this.apiKey || this.status === "off") {
      return null;
    }
    const url = `${this.baseUrl}${path}`;
    let lastDetail = "";
    for (let attempt = 0; attempt <= OpenAiLayer.retries; attempt += 1) {
      try {
        const response = await this.fetchFn(url, {
          method,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: method === "GET" ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(OpenAiLayer.timeoutMs),
        });
        if (!response.ok) {
          lastDetail = `[shared-context] openai ${path} HTTP ${response.status}`;
          if (response.status >= 500 && attempt < OpenAiLayer.retries) {
            continue;
          }
          OpenAiLayer.lastError = lastDetail;
          process.stderr.write(`${lastDetail}\n`);
          return null;
        }
        OpenAiLayer.lastError = null;
        return (await response.json()) as T;
      } catch (error) {
        lastDetail = `[shared-context] openai ${path} failed: ${String(error)}`;
        if (attempt < OpenAiLayer.retries) {
          continue;
        }
        OpenAiLayer.lastError = lastDetail;
        process.stderr.write(`${lastDetail}\n`);
        return null;
      }
    }
    OpenAiLayer.lastError = lastDetail || `[shared-context] openai ${path} failed`;
    return null;
  }
}
