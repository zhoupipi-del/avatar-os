import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { kernelEventBus } from "../src/event-bus";
import {
  createInitialSnapshot,
  recordIntent,
  recordSpeech,
  recordAction,
  recordClip,
  recordMood,
  type AgentRuntimeSnapshot,
} from "../src/agent-runtime-snapshot";

// 复刻 DebugConsole 的事件→快照订阅（旁路只读），跑一次 GREET 全链路，
// 断言 LIVE STATE 与验收标准一致。不依赖 Ollama / Tauri / React —— 纯事件驱动验证。
describe("AgentRuntimeSnapshot · GREET 全链路验收", () => {
  let snap: AgentRuntimeSnapshot;
  const unsubs: Array<() => void> = [];

  beforeEach(() => {
    snap = createInitialSnapshot();
    unsubs.length = 0;
    // 认知侧
    unsubs.push(
      kernelEventBus.on("INTENT_NORMALIZED", (p) => {
        snap = recordIntent(snap, p.normalized);
      }),
    );
    unsubs.push(
      kernelEventBus.on("AVATAR_THOUGHT", (p) => {
        if (p.kind === "speech") snap = recordSpeech(snap, p.text ?? "");
      }),
    );
    // 行为侧
    unsubs.push(
      kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (p) => {
        snap = recordAction(snap, p.type);
      }),
    );
    // 身体侧
    unsubs.push(
      kernelEventBus.on("AVATAR_PRIMITIVE", (p) => {
        if (p.detail.startsWith("clip=")) snap = recordClip(snap, p.detail.slice(5));
      }),
    );
    unsubs.push(
      kernelEventBus.on("STATE_MOOD_CHANGED", (p) => {
        snap = recordMood(snap, p.mood);
      }),
    );
  });

  // 事件总线是全局单例：每个用例跑完必须退订，避免污染后续用例。
  afterEach(() => {
    unsubs.forEach((u) => u());
    unsubs.length = 0;
  });

  it('输入"你好" → LIVE STATE 与验收矩阵一致', () => {
    // 以下事件序列即真实 GREET 链路会广播的内容：
    kernelEventBus.emit("INTENT_NORMALIZED", { raw: "GREET", normalized: "GREET", matched: true });
    kernelEventBus.emit("AVATAR_THOUGHT", { kind: "speech", text: "你好，我在这里" });
    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", { type: "GREET" } as any);
    kernelEventBus.emit("AVATAR_PRIMITIVE", { type: "PLAY_ANIMATION", detail: "clip=NlaTrack.001" });
    kernelEventBus.emit("STATE_MOOD_CHANGED", { mood: "HAPPY" } as any);

    // 验收标准逐字段对照：
    expect(snap.cognition.lastIntent).toBe("GREET"); // Intent: GREET
    expect(snap.cognition.speech).toBe("你好，我在这里"); // Speech: 你好，我在这里
    expect(snap.behavior.currentAction).toBe("GREET"); // Action: GREET
    expect(snap.behavior.currentClip).toBe("NlaTrack.001"); // Clip: NlaTrack.001
    expect(snap.avatar.animation).not.toBeNull(); // Avatar: playing
    expect(snap.avatar.mood).toBe("HAPPY"); // Mood: Happy
    // confidence 恒为 null（不编造）
    expect(snap.cognition.confidence).toBeNull();
  });

  it("收起 Debug（取消订阅）后，Avatar 行为不受影响：快照冻结，事件照常广播", () => {
    // 先跑一次完整 GREET，快照被填满
    kernelEventBus.emit("INTENT_NORMALIZED", { raw: "GREET", normalized: "GREET", matched: true });
    kernelEventBus.emit("AVATAR_THOUGHT", { kind: "speech", text: "你好" });
    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", { type: "GREET" } as any);
    kernelEventBus.emit("AVATAR_PRIMITIVE", { type: "PLAY_ANIMATION", detail: "clip=NlaTrack.001" });
    kernelEventBus.emit("STATE_MOOD_CHANGED", { mood: "HAPPY" } as any);
    expect(snap.behavior.currentClip).toBe("NlaTrack.001");

    // 收起 DebugConsole：退订全部监听
    unsubs.forEach((u) => u());
    unsubs.length = 0;

    // Avatar 继续被驱动（身体端不依赖 DebugConsole）
    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", { type: "STRETCH" } as any);
    kernelEventBus.emit("AVATAR_PRIMITIVE", { type: "PLAY_ANIMATION", detail: "clip=NlaTrack.002" });

    // 快照已冻结在上次值（旁路：不控制 Avatar，也不被新事件更新）
    expect(snap.behavior.currentAction).toBe("GREET"); // 未变成 STRETCH
    expect(snap.behavior.currentClip).toBe("NlaTrack.001"); // 未变成 NlaTrack.002
    expect(snap.avatar.animation).toBe("NlaTrack.001"); // 仍视为 playing（上次片段）
  });
});
