import { describe, it, expect } from "vitest";
import {
  nextLifePhase,
  phaseDefaultIntent,
  LifePhaseMachine,
  LifePhase,
  LifePhaseSignals,
} from "./life-phase";

/** 构造一组基线信号，便于每个用例只覆盖关心的维度。 */
function signals(over: Partial<LifePhaseSignals> = {}): LifePhaseSignals {
  return {
    userInteracting: false,
    userActive: false,
    idleMs: 0,
    energy: 1.0,
    lonelinessPressure: 0.0,
    isNight: false,
    ...over,
  };
}

describe("nextLifePhase — 转移边", () => {
  it("awake: 有互动→active，无互动→idle", () => {
    expect(nextLifePhase("awake", signals({ userInteracting: true }))).toBe("active");
    expect(nextLifePhase("awake", signals({}))).toBe("idle");
  });

  it("active: 能量低→tired，孤独→lonely，无互动→idle", () => {
    expect(nextLifePhase("active", signals({ energy: 0.2 }))).toBe("tired");
    expect(nextLifePhase("active", signals({ lonelinessPressure: 0.8 }))).toBe("lonely");
    expect(nextLifePhase("active", signals({ userInteracting: false }))).toBe("idle");
    expect(nextLifePhase("active", signals({ userInteracting: true }))).toBe("active");
  });

  it("idle: 移鼠标(活跃未互动)→curious，能量低→tired，孤独压力→lonely，久无人→lonely，夜间长空闲→sleeping", () => {
    // 验收关键：鼠标移动 = userActive 但非 userInteracting → curious（不是 active）
    expect(nextLifePhase("idle", signals({ userActive: true, idleMs: 5_000 }))).toBe("curious");
    expect(nextLifePhase("idle", signals({ energy: 0.2 }))).toBe("tired");
    expect(nextLifePhase("idle", signals({ lonelinessPressure: 0.8 }))).toBe("lonely");
    // 久无人（时间兜底）→ lonely
    expect(
      nextLifePhase("idle", signals({ userActive: false, idleMs: 200_000 })),
    ).toBe("lonely");
    // 夜间 + 长空闲 → sleeping
    expect(
      nextLifePhase("idle", signals({ isNight: true, idleMs: 200_000, energy: 0.1 })),
    ).toBe("sleeping");
    expect(nextLifePhase("idle", signals({}))).toBe("idle");
  });

  it("idle: 用户点击/触碰(互动)→active，而非 curious", () => {
    expect(
      nextLifePhase("idle", signals({ userInteracting: true, userActive: true, idleMs: 5_000 })),
    ).toBe("active");
  });

  it("curious: 互动→active，长空闲→idle(再由 idle→lonely)，孤独压力→lonely", () => {
    expect(nextLifePhase("curious", signals({ userInteracting: true }))).toBe("active");
    expect(nextLifePhase("curious", signals({ idleMs: 60_000 }))).toBe("idle");
    expect(nextLifePhase("curious", signals({ lonelinessPressure: 0.8 }))).toBe("lonely");
    // 久无人：curious 先过期到 idle（再由 idle 的时间兜底转入 lonely）
    expect(nextLifePhase("curious", signals({ userActive: false, idleMs: 200_000 }))).toBe("idle");
  });

  it("tired: 互动→active，能量恢复→idle，夜间长空闲→sleeping，否则保持 tired", () => {
    expect(nextLifePhase("tired", signals({ userInteracting: true }))).toBe("active");
    expect(nextLifePhase("tired", signals({ energy: 0.8 }))).toBe("idle");
    expect(nextLifePhase("tired", signals({ isNight: true, idleMs: 200_000 }))).toBe("sleeping");
    expect(nextLifePhase("tired", signals({ energy: 0.2 }))).toBe("tired");
  });

  it("lonely: 互动→active，压力下降→idle，夜间长空闲→sleeping，否则保持 lonely", () => {
    expect(nextLifePhase("lonely", signals({ userInteracting: true }))).toBe("active");
    expect(nextLifePhase("lonely", signals({ lonelinessPressure: 0.1 }))).toBe("idle");
    expect(
      nextLifePhase("lonely", signals({ isNight: true, idleMs: 200_000 })),
    ).toBe("sleeping");
    expect(nextLifePhase("lonely", signals({ lonelinessPressure: 0.8 }))).toBe("lonely");
  });

  it("sleeping: 互动或用户活跃→awake，夜间且无人→保持", () => {
    expect(nextLifePhase("sleeping", signals({ userInteracting: true }))).toBe("awake");
    expect(nextLifePhase("sleeping", signals({ userActive: true }))).toBe("awake");
    expect(nextLifePhase("sleeping", signals({ isNight: true, userActive: false }))).toBe("sleeping");
  });

  it("sleeping: 白天用户离开很久(安静下来打盹)→sleeping 持续", () => {
    expect(
      nextLifePhase("sleeping", signals({ isNight: false, userActive: false, idleMs: 200_000 })),
    ).toBe("sleeping");
  });

  it("lonely: 白天久离(>5min)→sleeping 打盹", () => {
    expect(
      nextLifePhase("lonely", signals({ isNight: false, userActive: false, idleMs: 360_000 })),
    ).toBe("sleeping");
  });
});

describe("phaseDefaultIntent — 阶段→默认身体意图", () => {
  it("sleeping→DOZE 弱，idle→IDLE_BREATHE 中，curious/active/awake→LOOK_AT_USER 强", () => {
    expect(phaseDefaultIntent("sleeping")).toEqual({ type: "DOZE", intensity: 0.2 });
    expect(phaseDefaultIntent("idle")).toEqual({ type: "IDLE_BREATHE", intensity: 0.6 });
    expect(phaseDefaultIntent("curious")).toEqual({ type: "LOOK_AT_USER", intensity: 0.5 });
    expect(phaseDefaultIntent("active")).toEqual({ type: "LOOK_AT_USER", intensity: 0.85 });
    expect(phaseDefaultIntent("awake")).toEqual({ type: "LOOK_AT_USER", intensity: 0.9 });
  });

  it("tired/lonely 用低强度呼吸，区别于 active 的强注视", () => {
    expect(phaseDefaultIntent("tired").type).toBe("IDLE_BREATHE");
    expect(phaseDefaultIntent("lonely").type).toBe("IDLE_BREATHE");
    expect(phaseDefaultIntent("tired").intensity).toBeLessThan(phaseDefaultIntent("active").intensity);
  });
});

describe("LifePhaseMachine — 去重", () => {
  it("未变化返回 null（去重），变化返回新值", () => {
    const m = new LifePhaseMachine("idle");
    // idle 在默认信号下保持 idle → 去重
    expect(m.transition(signals({}))).toBeNull();
    expect(m.phase).toBe("idle");
    // 互动触发 active
    expect(m.transition(signals({ userInteracting: true }))).toBe("active");
    expect(m.phase).toBe("active");
    // 再次同信号 → 去重
    expect(m.transition(signals({ userInteracting: true }))).toBeNull();
  });

  it("set 仅在真变化时返回 true", () => {
    const m = new LifePhaseMachine("awake");
    expect(m.set("awake")).toBe(false);
    expect(m.set("sleeping")).toBe(true);
    expect(m.phase).toBe("sleeping");
  });

  it("所有阶段都可被 nextLifePhase 解析（无 undefined 返回）", () => {
    const phases: LifePhase[] = [
      "awake",
      "active",
      "idle",
      "curious",
      "tired",
      "lonely",
      "sleeping",
    ];
    for (const p of phases) {
      const r = nextLifePhase(p, signals({ userInteracting: true, userActive: true }));
      expect(r).toBeDefined();
      expect(phases).toContain(r);
    }
  });
});
