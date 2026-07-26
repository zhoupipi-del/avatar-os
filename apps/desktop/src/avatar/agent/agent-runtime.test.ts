import { describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "./agent-runtime";
import type {
  AgentBodyBridge,
  AgentBrain,
  AgentBrainOutput,
} from "./agent-intent";

function createBodyMock(): AgentBodyBridge {
  return {
    speakText: vi.fn(),
    playIntent: vi.fn(),
    setEmotion: vi.fn(),
    stop: vi.fn(),
  };
}

describe("AgentRuntime", () => {
  it("dispatches brain output to body bridge", async () => {
    const brain: AgentBrain = {
      think: vi.fn(async (): Promise<AgentBrainOutput> => ({
        speech: "你好。",
        intent: { type: "GREET", intensity: 0.8 },
        emotion: { type: "happy", intensity: 0.5 },
      })),
    };

    const body = createBodyMock();
    const runtime = new AgentRuntime(brain, body);

    const output = await runtime.receiveText("你好");

    expect(output?.speech).toBe("你好。");
    expect(body.speakText).toHaveBeenCalledWith("你好。");
    expect(body.setEmotion).toHaveBeenCalledWith({
      type: "happy",
      intensity: 0.5,
    });
    expect(body.playIntent).toHaveBeenCalledWith({
      type: "GREET",
      intensity: 0.8,
    });
  });

  it("ignores stale async output after interruption", async () => {
    const slot: { resolve?: (value: AgentBrainOutput) => void } = {};

    const brain: AgentBrain = {
      think: vi.fn(
        (): Promise<AgentBrainOutput> =>
          new Promise<AgentBrainOutput>((resolve) => {
            slot.resolve = resolve;
          }),
      ),
    };

    const body = createBodyMock();
    const runtime = new AgentRuntime(brain, body);

    const pending = runtime.receiveText("你好");
    runtime.interrupt();

    slot.resolve?.({
      speech: "迟到的回复",
      intent: { type: "GREET", intensity: 1 },
      emotion: { type: "happy", intensity: 1 },
    });

    const output = await pending;

    expect(output).toBeNull();
    expect(body.speakText).not.toHaveBeenCalledWith("迟到的回复");
    expect(body.stop).toHaveBeenCalled();
  });

  it("falls back safely when brain throws", async () => {
    const brain: AgentBrain = {
      think: vi.fn(async (): Promise<AgentBrainOutput> => {
        throw new Error("LLM offline");
      }),
    };

    const body = createBodyMock();
    const runtime = new AgentRuntime(brain, body);

    const output = await runtime.receiveText("测试");

    expect(output?.speech).toContain("我刚才有点卡住了");
    expect(body.speakText).toHaveBeenCalled();
    expect(runtime.snapshot().error).toBe("LLM offline");
  });
});
