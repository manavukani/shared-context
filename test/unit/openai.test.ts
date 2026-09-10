import { describe, it } from "node:test";
import { AppConfig } from "../../src/config.js";
import { OpenAiLayer } from "../../src/ai/openai.js";
import { expect } from "../expect.js";

describe("OpenAiLayer", () => {
  it("degrades when the API key is missing", () => {
    const ai = new OpenAiLayer(new AppConfig("/tmp/config.json", AppConfig.defaults()), "");
    expect(ai.status).toBe("degraded");
    expect(ai.enabled).toBe(false);
  });

  it("stays off when config disables AI", () => {
    const data = AppConfig.defaults();
    data.ai.enabled = false;
    const ai = new OpenAiLayer(new AppConfig("/tmp/config.json", data), "sk-test");
    expect(ai.status).toBe("off");
  });

  it("computes cosine similarity", () => {
    expect(OpenAiLayer.cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(OpenAiLayer.cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("records AI failures so doctor can surface them", async () => {
    OpenAiLayer.lastError = null;
    const fetchFn = (async () => {
      throw new Error("gateway down");
    }) as typeof fetch;
    const ai = new OpenAiLayer(new AppConfig("/tmp/config.json", AppConfig.defaults()), "sk-test", fetchFn);
    expect(await ai.embed("hello")).toBe(null);
    expect(OpenAiLayer.lastError).toContain("gateway down");
    expect(await ai.probe()).toBe(false);
  });

  it("retries failed fetches then succeeds", async () => {
    OpenAiLayer.lastError = null;
    let attempts = 0;
    const fetchFn = (async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("temporary");
      }
      return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const ai = new OpenAiLayer(new AppConfig("/tmp/config.json", AppConfig.defaults()), "sk-test", fetchFn);
    const embedding = await ai.embed("hello");
    expect(attempts).toBe(3);
    expect(embedding?.[0]).toBe(1);
    expect(OpenAiLayer.lastError).toBe(null);
  });
});
