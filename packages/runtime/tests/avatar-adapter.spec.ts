import { describe, it, expect, vi, afterEach } from "vitest";
import * as THREE from "three";
import { AnimationManager } from "../src/avatar-adapter/animation-manager";
import { BehaviorVMAdapter } from "../src/avatar-adapter/behavior-bridge";
import { BagCharacterExpression, moodToExpression } from "../src/avatar-adapter/expression-interface";
import { kernelEventBus } from "../src/event-bus";
import { Mood } from "@avatar-os/primitives";

describe("AnimationManager", () => {
  const root = new THREE.Object3D();
  const clips = [
    new THREE.AnimationClip("idle", 1, []),
    new THREE.AnimationClip("NlaTrack.001", 1, []),
  ];
  const am = new AnimationManager(root, clips, { idleClip: "idle" });

  it("按名/大小写不敏感检索片段", () => {
    expect(am.has("idle")).toBe(true);
    expect(am.has("IDLE")).toBe(true);
    expect(am.has("nlatrack.001")).toBe(true);
    expect(am.has("missing")).toBe(false);
  });

  it("play / playOnce / tick 不抛错", () => {
    expect(() => {
      am.play("idle");
      am.playOnce("NlaTrack.001");
      am.tick(0.016);
    }).not.toThrow();
  });
});

describe("BagCharacterExpression", () => {
  it("Mood → 语义表情方法映射正确", () => {
    expect(moodToExpression(Mood.HAPPY)).toBe("happy");
    expect(moodToExpression(Mood.EXCITED)).toBe("happy");
    expect(moodToExpression(Mood.SAD)).toBe("sad");
    expect(moodToExpression(Mood.LONELY)).toBe("sad");
    expect(moodToExpression(Mood.TIRED)).toBe("drowsy");
    expect(moodToExpression(Mood.SLEEPING)).toBe("drowsy");
    expect(moodToExpression(Mood.FOCUSED)).toBe("thinking");
    expect(moodToExpression(Mood.CURIOUS)).toBe("thinking");
    expect(moodToExpression(Mood.CALM)).toBe("idle");
  });

  it("无脊椎骨时 update 为 no-op 不报错", () => {
    const expr = new BagCharacterExpression(null);
    expr.happy();
    expect(() => expr.update(0.016)).not.toThrow();
  });

  it("有脊椎骨时 update 平滑写入旋转", () => {
    const bone = new THREE.Object3D();
    const expr = new BagCharacterExpression(bone);
    expr.happy();
    for (let i = 0; i < 30; i++) expr.update(0.016);
    // 开心 → 轻微后仰(rotation.x 趋近 -0.2)
    expect(bone.rotation.x).toBeLessThan(-0.1);
    expect(bone.rotation.x).toBeGreaterThan(-0.25);
  });
});

describe("BehaviorVMAdapter", () => {
  const makeMocks = () => ({
    animation: {
      play: vi.fn(),
      playOnce: vi.fn(),
      tick: vi.fn(),
      has: vi.fn(() => true),
    } as any,
    expression: {
      happy: vi.fn(),
      sad: vi.fn(),
      thinking: vi.fn(),
      drowsy: vi.fn(),
      idle: vi.fn(),
      update: vi.fn(),
    } as any,
  });

  const maps = {
    idleClip: "NlaTrack",
    intentClip: { GREET: "NlaTrack.001", BOUNCE_HAPPY: "NlaTrack.002" } as Record<string, string>,
    statusClip: { success: "NlaTrack.002", error: "NlaTrack.001" } as Record<string, string>,
  };

  afterEach(() => {
    // 确保测试间不残留订阅
    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", {
      type: "IDLE_BREATHE",
      intensity: 1,
      priority: 10,
      source: "SYSTEM",
      confidence: 1,
      timestamp: Date.now(),
    });
  });

  it("物理意图 → 对应片段 playOnce", () => {
    const { animation, expression } = makeMocks();
    const bridge = new BehaviorVMAdapter(animation, expression, maps);
    bridge.connect();
    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", {
      type: "GREET",
      intensity: 0.8,
      priority: 10,
      source: "SYSTEM",
      confidence: 1,
      timestamp: Date.now(),
    });
    expect(animation.playOnce).toHaveBeenCalledWith("NlaTrack.001");
    bridge.disconnect();
  });

  it("情绪 → 对应表情方法", () => {
    const { animation, expression } = makeMocks();
    const bridge = new BehaviorVMAdapter(animation, expression, maps);
    bridge.connect();
    kernelEventBus.emit("STATE_MOOD_CHANGED", { mood: Mood.SAD });
    expect(expression.sad).toHaveBeenCalled();
    bridge.disconnect();
  });

  it("系统状态 → 对应片段 playOnce", () => {
    const { animation, expression } = makeMocks();
    const bridge = new BehaviorVMAdapter(animation, expression, maps);
    bridge.connect();
    kernelEventBus.emit("SYSTEM_STATUS_CHANGED", { status: "success" });
    expect(animation.playOnce).toHaveBeenCalledWith("NlaTrack.002");
    bridge.disconnect();
  });

  it("disconnect 后不再响应事件", () => {
    const { animation, expression } = makeMocks();
    const bridge = new BehaviorVMAdapter(animation, expression, maps);
    bridge.connect();
    bridge.disconnect();
    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", {
      type: "GREET",
      intensity: 0.8,
      priority: 10,
      source: "SYSTEM",
      confidence: 1,
      timestamp: Date.now(),
    });
    expect(animation.playOnce).not.toHaveBeenCalled();
  });
});
