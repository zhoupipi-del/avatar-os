// ============================================================
// RuntimeKernel 集成测试
// ============================================================
// 原则（与"虚假安全感"绝缘）：
//   - 不 mock kernelEventBus.emit；而是注册【真实的监听器】收集事件
//   - 用 stub MemoryLike / stub CognitionDriver 记录真实调用，验证链路真的发生
//   - proactive 自发触发用 fake timers 真实推进，而非假设
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RuntimeKernel, type MemoryLike, type CognitionDriver } from "../src/runtime-kernel";
import { kernelEventBus } from "../src/event-bus";

function makeMemoryStub() {
  const calls: Array<{ eventType: string; payload?: unknown; importanceScore: number; timestamp: number }> = [];
  const memory: MemoryLike = {
    async remember(ev) {
      calls.push(ev);
    },
  };
  return { memory, calls };
}

function makeDriverStub() {
  const calls: Array<{ text: string }> = [];
  const driver: CognitionDriver = {
    async stimulate(input) {
      calls.push({ text: input.text });
    },
  };
  return { driver, calls };
}

describe("RuntimeKernel — 闭环入口编排", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("SPEECH_INPUT → 认知驱动被真实调用（含原始文本）", () => {
    const mem = makeMemoryStub();
    const drv = makeDriverStub();
    const kernel = new RuntimeKernel({ cognition: drv.driver, memory: mem.memory, getLifeState: () => ({ mood: "CALM", energy: 1, loneliness: 0 }) });
    kernel.start();

    kernelEventBus.emit("SPEECH_INPUT", { text: "你好，挥个手", timestamp: 123 });

    expect(drv.calls.length).toBe(1);
    expect(drv.calls[0].text).toBe("你好，挥个手");
    kernel.stop();
  });

  it("MEMORY_APPEND(user) → 真落库为 EVENT_USER_SPEECH", () => {
    const mem = makeMemoryStub();
    const drv = makeDriverStub();
    const kernel = new RuntimeKernel({ cognition: drv.driver, memory: mem.memory, getLifeState: () => ({ mood: "CALM", energy: 1, loneliness: 0 }) });
    kernel.start();

    kernelEventBus.emit("MEMORY_APPEND", { source: "user", content: "用户说的一句话", timestamp: 456 });

    expect(mem.calls.length).toBe(1);
    expect(mem.calls[0].eventType).toBe("EVENT_USER_SPEECH");
    expect((mem.calls[0].payload as { content: string }).content).toBe("用户说的一句话");
    expect(mem.calls[0].importanceScore).toBe(0.7);
    kernel.stop();
  });

  it("MEMORY_APPEND(avatar) → 落库为 EVENT_AVATAR_SPEECH", () => {
    const mem = makeMemoryStub();
    const drv = makeDriverStub();
    const kernel = new RuntimeKernel({ cognition: drv.driver, memory: mem.memory, getLifeState: () => ({ mood: "CALM", energy: 1, loneliness: 0 }) });
    kernel.start();

    kernelEventBus.emit("MEMORY_APPEND", { source: "avatar", content: "AI 的回复", timestamp: 789 });

    expect(mem.calls[0].eventType).toBe("EVENT_AVATAR_SPEECH");
    kernel.stop();
  });

  it("无认知驱动时，SPEECH_INPUT 不抛错（优雅降级）", () => {
    const mem = makeMemoryStub();
    const kernel = new RuntimeKernel({ memory: mem.memory, getLifeState: () => ({ mood: "CALM", energy: 1, loneliness: 0 }) });
    kernel.start();
    expect(() => kernelEventBus.emit("SPEECH_INPUT", { text: "没人听", timestamp: 1 })).not.toThrow();
    kernel.stop();
  });

  it("proactive：孤独感超阈值且长时间无互动 → 自发 stimulate(空文本)", () => {
    const mem = makeMemoryStub();
    const drv = makeDriverStub();
    const kernel = new RuntimeKernel({
      cognition: drv.driver,
      memory: mem.memory,
      getLifeState: () => ({ mood: "LONELY", energy: 0.5, loneliness: 0.9 }),
      proactive: { enabled: true, lonelinessThreshold: 0.7, intervalMs: 100, idleMs: 1 },
    });
    kernel.start();

    // 推进一个周期，自发触发应发生
    vi.advanceTimersByTime(150);

    expect(drv.calls.length).toBeGreaterThanOrEqual(1);
    expect(drv.calls[0].text).toBe(""); // 自发思考：空文本
    kernel.stop();
  });

  it("proactive 关闭时，即便孤独也不自发触发", () => {
    const mem = makeMemoryStub();
    const drv = makeDriverStub();
    const kernel = new RuntimeKernel({
      cognition: drv.driver,
      memory: mem.memory,
      getLifeState: () => ({ mood: "LONELY", energy: 0.5, loneliness: 0.9 }),
      proactive: { enabled: false },
    });
    kernel.start();
    vi.advanceTimersByTime(500);
    expect(drv.calls.length).toBe(0);
    kernel.stop();
  });
});
