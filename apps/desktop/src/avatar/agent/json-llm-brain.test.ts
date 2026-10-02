import { describe, expect, it } from "vitest";

import { RuleBasedBrain } from "./rule-based-brain";
import { JsonLlmBrain } from "./json-llm-brain";
import type { LlmProvider } from "./llm-provider";

function makeBrain(provider: LlmProvider): JsonLlmBrain {
  return new JsonLlmBrain(provider, { fallback: new RuleBasedBrain() });
}

const HELLO_JSON =
  '{"speech":"你好呀","intent":{"type":"GREET","intensity":0.8},"emotion":{"type":"happy","intensity":0.5}}';

function okProvider(content: string): LlmProvider {
  return {
    name: "fake-ok",
    async isAvailable() {
      return true;
    },
    async complete() {
      return content;
    },
  };
}

function throwProvider(): LlmProvider {
  return {
    name: "fake-down",
    async isAvailable() {
      return false;
    },
    async complete() {
      throw new Error("Ollama unreachable");
    },
  };
}

describe("JsonLlmBrain", () => {
  it("parses normal JSON output into intent/emotion", async () => {
    const brain = makeBrain(okProvider(HELLO_JSON));
    const output = await brain.think({ text: "你好" });

    expect(output.speech).toBe("你好呀");
    expect(output.intent.type).toBe("GREET");
    expect(output.emotion.type).toBe("happy");
  });

  it("falls back to RuleBasedBrain when provider is unavailable", async () => {
    const brain = makeBrain(throwProvider());
    const output = await brain.think({ text: "你好" });

    // RuleBasedBrain 对“你好”的回复
    expect(output.intent.type).toBe("GREET");
    expect(output.speech).toContain("你好");
  });

  it("falls back to RuleBasedBrain when provider throws", async () => {
    const brain = makeBrain(throwProvider());
    const output = await brain.think({ text: "我今天有点累" });

    expect(output.intent.type).toBe("SAD_BODY");
    expect(output.speech).toContain("听到");
  });

  it("falls back when LLM returns non-JSON prose", async () => {
    const brain = makeBrain(okProvider("这不是JSON纯文本回复"));
    const output = await brain.think({ text: "你好" });

    expect(output.intent.type).toBe("GREET");
    expect(output.speech).toContain("你好");
  });

  it("clamps speech length to maxSpeechLength", async () => {
    const longSpeech = "长".repeat(120);
    const longJson = `{"speech":"${longSpeech}","intent":{"type":"GREET","intensity":0.5},"emotion":{"type":"happy","intensity":0.5}}`;
    const brain = new JsonLlmBrain(okProvider(longJson), {
      fallback: new RuleBasedBrain(),
      maxSpeechLength: 40,
    });

    const output = await brain.think({ text: "你好" });

    expect(output.speech.length).toBeLessThanOrEqual(40);
    expect(output.intent.type).toBe("GREET");
  });
});
