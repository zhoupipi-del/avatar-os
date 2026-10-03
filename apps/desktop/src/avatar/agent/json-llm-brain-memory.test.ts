import { describe, expect, it } from "vitest";
import { JsonLlmBrain, isStatusReportingBrain } from "./json-llm-brain";
import { ConversationMemory } from "./conversation-memory";
import { RuleBasedBrain } from "./rule-based-brain";
import type { LlmMessage, LlmProvider } from "./llm-provider";

function recordingProvider(reply: (text: string) => string) {
  const calls: { userText: string; history: readonly LlmMessage[] }[] = [];
  const provider: LlmProvider = {
    name: "fake",
    async isAvailable() {
      return true;
    },
    async complete(_system, userText, history = []) {
      calls.push({ userText, history });
      return reply(userText);
    },
  };
  return { provider, calls };
}

const json = (speech: string) =>
  JSON.stringify({ speech, intent: { type: "NONE", intensity: 0 }, emotion: { type: "neutral", intensity: 0 } });

describe("JsonLlmBrain — 多轮记忆", () => {
  it("sends previous turns as history and records the new turn", async () => {
    const { provider, calls } = recordingProvider((t) => json(t === "我叫小林" ? "你好小林" : "你叫小林"));
    const memory = new ConversationMemory();
    const brain = new JsonLlmBrain(provider, { memory, fallback: new RuleBasedBrain() });

    await brain.think({ text: "我叫小林" });
    const out = await brain.think({ text: "我叫什么？" });

    expect(out.speech).toBe("你叫小林");
    expect(calls[0]!.history).toEqual([]);
    expect(calls[1]!.history).toEqual([
      { role: "user", content: "我叫小林" },
      { role: "assistant", content: JSON.stringify({ speech: "你好小林" }) },
    ]);
    expect(memory.size()).toBe(4);
  });

  it("still records turns when falling back to rule brain", async () => {
    const provider: LlmProvider = {
      name: "down",
      async isAvailable() {
        return false;
      },
      async complete() {
        throw new Error("ECONNREFUSED");
      },
    };
    const memory = new ConversationMemory();
    const brain = new JsonLlmBrain(provider, { memory });
    const out = await brain.think({ text: "你好" });
    expect(memory.all().map((t) => t.text)).toEqual(["你好", out.speech]);
  });

  it("works without memory (backward compatible)", async () => {
    const { provider, calls } = recordingProvider(() => json("嗯"));
    const brain = new JsonLlmBrain(provider);
    await brain.think({ text: "a" });
    await brain.think({ text: "b" });
    expect(calls[1]!.history).toEqual([]);
  });
});

describe("JsonLlmBrain — 真实状态上报", () => {
  it("reports llm after a successful reply", async () => {
    const { provider } = recordingProvider(() => json("好"));
    const brain = new JsonLlmBrain(provider);
    expect(isStatusReportingBrain(brain)).toBe(true);
    expect(brain.getStatus().source).toBe("unknown");
    await brain.think({ text: "hi" });
    expect(brain.getStatus().source).toBe("llm");
  });

  it("reports fallback with the error when provider fails or emits non-JSON", async () => {
    const down: LlmProvider = {
      name: "ollama",
      async isAvailable() {
        return false;
      },
      async complete() {
        throw new Error("ECONNREFUSED");
      },
    };
    const a = new JsonLlmBrain(down);
    await a.think({ text: "hi" });
    expect(a.getStatus()).toMatchObject({ source: "fallback", lastError: "ECONNREFUSED" });

    const { provider: prose } = recordingProvider(() => "我不会用 JSON 说话");
    const b = new JsonLlmBrain(prose);
    await b.think({ text: "hi" });
    expect(b.getStatus().source).toBe("fallback");
  });

  it("probe() reflects provider reachability", async () => {
    const down: LlmProvider = {
      name: "ollama",
      async isAvailable() {
        return false;
      },
      async complete() {
        return "";
      },
    };
    expect((await new JsonLlmBrain(down).probe()).source).toBe("fallback");
    const { provider: up } = recordingProvider(() => json("x"));
    expect((await new JsonLlmBrain(up).probe()).source).toBe("llm");
  });
});
