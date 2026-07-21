// ============================================================
// integration.test — Cognition <-> EventBus 真实集成（无任何 emit Mock）
// ============================================================
// 设计原则（回应审计中"Mock 掉 emit = 拆承重墙测刷漆"的警示）：
//   - 不劫持 kernelEventBus.emit，而是给【真实】 EventBus 挂监听器收集事件。
//   - 只劫持全局 fetch，模拟真实的 Ollama deepseek-r1 HTTP 响应体。
//   - 断言基于真实流过总线的 payload，而非被测对象的内部状态。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CognitionEngine } from "../src/cognition-engine";
import { OllamaProvider } from "../src/provider";
import { kernelEventBus } from "@avatar-os/runtime";
import { Mood } from "@avatar-os/primitives";

describe("Cognition <-> EventBus 真实集成测试", () => {
  const received: Array<{ type: string; payload: any }> = [];
  const offs: Array<() => void> = [];
  const mockSandbox = { dispatchExternalIntent: vi.fn(() => true) };

  beforeEach(() => {
    received.length = 0;
    vi.clearAllMocks();
    // 给真实 EventBus 挂上收集监听器（顺便验证事件确实流过总线）
    const types = ["AVATAR_THOUGHT", "MEMORY_APPEND", "STATE_MOOD_CHANGED", "SPEECH_INPUT"] as const;
    for (const t of types) {
      const off = kernelEventBus.on(t, (p: any) => received.push({ type: t, payload: p }));
      offs.push(off);
    }
    // 只劫持 fetch，不动 emit —— 这是"真实集成"与"虚假安全感"的分界线
    (globalThis as any).fetch = vi.fn();
  });

  afterEach(() => {
    offs.forEach((off) => off());
    offs.length = 0;
    vi.restoreAllMocks();
  });

  it("防线 1 & 2: 真实 deepseek-r1 思考链穿透清洗并触发总线", async () => {
    // 模拟带 <think> 思维链 + markdown 代码块包裹的真实恶劣输出
    const mockOllamaResponse = {
      model: "deepseek-r1:8b",
      message: {
        role: "assistant",
        content:
          "<think>\n用户在打招呼，我要回复他。\n</think>\n```json\n{\"intent\":\"GREET\",\"speech\":\"你好啊！\",\"mood\":\"HAPPY\"}\n```",
      },
      done: true,
    };
    vi.mocked((globalThis as any).fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOllamaResponse,
    } as any);

    await new CognitionEngine(mockSandbox, new OllamaProvider()).think({
      userInput: "测试输入",
      recentMemories: [],
      currentMood: Mood.CALM,
      energy: 1,
      loneliness: 0,
    });

    // 客观事实记忆（不等 AI 返回就落盘了）
    expect(received).toContainEqual({
      type: "MEMORY_APPEND",
      payload: expect.objectContaining({ source: "user", content: "测试输入" }),
    });

    // 深层 JSON 清洗成功并触发正确的 speech 气泡
    expect(received).toContainEqual({
      type: "AVATAR_THOUGHT",
      payload: expect.objectContaining({ kind: "speech", text: "你好啊！" }),
    });

    // 触发正确的情绪变更
    expect(received).toContainEqual({
      type: "STATE_MOOD_CHANGED",
      payload: expect.objectContaining({ mood: "HAPPY" }),
    });

    // 派发正确的肢体意图（经 AgentSandbox，source=AI）
    expect(mockSandbox.dispatchExternalIntent).toHaveBeenCalledWith("GREET", 0.8);
  });

  it("防线 3: 畸形 JSON 不二次报错，且不会吞掉用户输入", async () => {
    vi.mocked((globalThis as any).fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { content: "这根本不是JSON" } }),
    } as any);

    await new CognitionEngine(mockSandbox, new OllamaProvider()).think({
      userInput: "我刚才说话了",
      recentMemories: [],
      currentMood: Mood.CALM,
      energy: 1,
      loneliness: 0,
    });

    // 尽管 AI 解析崩溃了，用户的输入依然被记住了
    expect(received).toContainEqual({
      type: "MEMORY_APPEND",
      payload: expect.objectContaining({ source: "user", content: "我刚才说话了" }),
    });

    // 没有非法的状态被广播（失败分支只清空气泡，不污染内核）
    const moodEvents = received.filter((e) => e.type === "STATE_MOOD_CHANGED");
    expect(moodEvents.length).toBe(0);
  });
});
