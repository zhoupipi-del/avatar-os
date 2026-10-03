import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./agent-runtime";
import { JsonLlmBrain } from "./json-llm-brain";
import { ConversationMemory } from "./conversation-memory";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import { OllamaProvider } from "./ollama-provider";
import type { AgentBodyBridge } from "./agent-intent";

const output = {
  speech: "新回复",
  emotion: { type: "happy" as const, intensity: 0.6 },
  intent: { type: "GREET" as const, intensity: 0.6 },
};

describe("turn cancellation", () => {
  it("stops the body at new input and discards aborted replies from memory/status", async () => {
    let release!: (text: string) => void;
    let oldSignal: AbortSignal | undefined;
    const memory = new ConversationMemory();
    const fallback = { think: vi.fn() };
    const brain = new JsonLlmBrain(
      {
        name: "test",
        isAvailable: async () => true,
        complete: vi.fn((_system, text, _history, signal) => {
          if (text === "旧问题") {
            oldSignal = signal;
            return new Promise<string>((resolve) => {
              release = resolve;
            });
          }
          return Promise.resolve(JSON.stringify(output));
        }),
      },
      { memory, fallback },
    );
    const body: AgentBodyBridge = {
      perform: vi.fn(),
      speakText: vi.fn(),
      playIntent: vi.fn(),
      setEmotion: vi.fn(),
      stop: vi.fn(),
    };
    const runtime = new AgentRuntime(brain, body);
    const old = runtime.receiveText("旧问题");
    const latest = runtime.receiveText("新问题");
    expect(oldSignal!.aborted).toBe(true);
    expect(body.stop).toHaveBeenCalledTimes(2);
    await latest;
    const status = brain.getStatus();
    release("迟到且无效的回复");
    expect(await old).toBeNull();
    expect(memory.all().map((turn) => turn.text)).toEqual(["新问题", "新回复"]);
    expect(brain.getStatus()).toEqual(status);
    expect(fallback.think).not.toHaveBeenCalled();
    expect(body.perform).toHaveBeenCalledOnce();
    expect(body.speakText).not.toHaveBeenCalled();
  });

  it.each(["cloud", "ollama"])(
    "cancels %s while response body is still being consumed",
    async (kind) => {
      let requestSignal: AbortSignal | undefined;
      let release!: (data: unknown) => void;
      const fetchImpl = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          requestSignal = init?.signal as AbortSignal;
          return {
            ok: true,
            json: () =>
              new Promise((resolve) => {
                release = resolve;
              }),
          } as Response;
        },
      );
      const provider =
        kind === "cloud"
          ? new OpenAICompatibleProvider({
              baseUrl: "https://example.test",
              apiKey: "test",
              model: "test",
              fetchImpl,
            })
          : new OllamaProvider({ fetchImpl });
      const controller = new AbortController();
      const request = provider.complete(
        "system",
        "user",
        [],
        controller.signal,
      );
      const rejected = expect(request).rejects.toMatchObject({
        name: "AbortError",
      });
      await Promise.resolve();
      controller.abort();
      await rejected;
      expect(requestSignal?.aborted).toBe(true);
      release({
        choices: [{ message: { content: "late" } }],
        message: { content: "late" },
      });
    },
  );
});
