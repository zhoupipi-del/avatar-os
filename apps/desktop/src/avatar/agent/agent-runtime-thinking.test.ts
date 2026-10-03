import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./agent-runtime";
import type { AgentBodyBridge, AgentBrain } from "./agent-intent";

describe("AgentRuntime — 思考态", () => {
  it("enters thinking before the brain answers and leaves it before speaking", async () => {
    const order: string[] = [];
    const body: AgentBodyBridge = {
      speakText: vi.fn(() => order.push("speak")),
      playIntent: vi.fn(),
      setEmotion: vi.fn(),
      setThinking: vi.fn((t: boolean) => order.push(`thinking:${t}`)),
    };
    const brain: AgentBrain = {
      think: async () => {
        order.push("brain");
        return { speech: "嗯", intent: { type: "NONE", intensity: 0 }, emotion: { type: "neutral", intensity: 0 } };
      },
    };
    await new AgentRuntime(brain, body).receiveText("hi");
    expect(order).toEqual(["thinking:true", "brain", "thinking:false", "speak"]);
  });

  it("leaves thinking on brain error and on interrupt", async () => {
    const setThinking = vi.fn();
    const body: AgentBodyBridge = { speakText: vi.fn(), playIntent: vi.fn(), setEmotion: vi.fn(), setThinking };
    const brain: AgentBrain = {
      think: async () => {
        throw new Error("x");
      },
    };
    const rt = new AgentRuntime(brain, body);
    await rt.receiveText("hi");
    expect(setThinking).toHaveBeenLastCalledWith(false);
    rt.interrupt();
    expect(setThinking).toHaveBeenLastCalledWith(false);
  });

  it("bodies without setThinking keep working", async () => {
    const body: AgentBodyBridge = { speakText: vi.fn(), playIntent: vi.fn(), setEmotion: vi.fn() };
    const brain: AgentBrain = {
      think: async () => ({ speech: "ok", intent: { type: "NONE", intensity: 0 }, emotion: { type: "neutral", intensity: 0 } }),
    };
    await expect(new AgentRuntime(brain, body).receiveText("hi")).resolves.toMatchObject({ speech: "ok" });
  });
});
