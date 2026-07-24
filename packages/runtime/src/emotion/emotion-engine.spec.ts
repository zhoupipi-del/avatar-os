// ============================================================
// Emotion Engine · 演化测试 (v0.3.6-C)
// ============================================================
// 覆盖：初始状态 / 用户互动(touch·speak) / 时间流逝(独处·在场) /
// 自主反馈(observe·interact) / 夹紧边界 / 情绪→人格调制恒等 & 语义。
// 铁律校验：引擎没有任何发意图的方法（结构上只维护状态）。

import { describe, it, expect } from "vitest";
import { EmotionEngine } from "./emotion-engine";
import {
  NEUTRAL_EMOTION,
  clampEmotion,
  applyEmotionToTraits,
  type EmotionState,
} from "./emotion-state";
import { NEUTRAL_TRAITS, clampTraits, type PersonalityTraits } from "../personality/behavior-tuning";

const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe("EmotionEngine · 初始与互动", () => {
  it("初始为中性情绪（全 0.5）", () => {
    const e = new EmotionEngine();
    expect(e.getState()).toEqual(NEUTRAL_EMOTION);
  });

  it("可注入初始情绪（如刚见面 loneliness 偏低）", () => {
    const e = new EmotionEngine({ ...NEUTRAL_EMOTION, loneliness: 0.2 });
    expect(e.getState().loneliness).toBe(0.2);
  });

  it("touch：comfort↑、trust↑、loneliness↓", () => {
    const e = new EmotionEngine();
    const s = e.applyInteraction("touch");
    expect(s.comfort).toBeGreaterThan(NEUTRAL_EMOTION.comfort);
    expect(s.trust).toBeGreaterThan(NEUTRAL_EMOTION.trust);
    expect(s.loneliness).toBeLessThan(NEUTRAL_EMOTION.loneliness);
  });

  it("speak：trust↑、comfort↑、loneliness↓（幅度小于 touch）", () => {
    const e = new EmotionEngine();
    const s = e.applyInteraction("speak");
    expect(s.trust).toBeGreaterThan(NEUTRAL_EMOTION.trust);
    expect(s.loneliness).toBeLessThan(NEUTRAL_EMOTION.loneliness);
    // 信任涨幅小于摸摸它
    const t = new EmotionEngine();
    const afterTouch = t.applyInteraction("touch");
    expect(s.trust - 0.5).toBeLessThan(afterTouch.trust - 0.5);
  });
});

describe("EmotionEngine · 时间流逝", () => {
  it("无人陪伴：loneliness↑、comfort↓", () => {
    const e = new EmotionEngine();
    const s = e.tick(10_000, false); // 10s 独处
    expect(s.loneliness).toBeGreaterThan(NEUTRAL_EMOTION.loneliness);
    expect(s.comfort).toBeLessThan(NEUTRAL_EMOTION.comfort);
  });

  it("用户在场：loneliness↓、comfort↑", () => {
    const e = new EmotionEngine({ ...NEUTRAL_EMOTION, loneliness: 0.9, comfort: 0.2 });
    const s = e.tick(10_000, true);
    expect(s.loneliness).toBeLessThan(0.9);
    expect(s.comfort).toBeGreaterThan(0.2);
  });

  it("独处 5 分钟：loneliness 明显累积（验证'等待会想你'）", () => {
    const e = new EmotionEngine();
    const s = e.tick(5 * 60_000, false);
    expect(s.loneliness).toBeGreaterThan(0.7); // 0.5 + 0.010*300 = 0.8
  });
});

describe("EmotionEngine · 自主行为反馈", () => {
  it("observe（主动观察）：curiosity 被满足而下降", () => {
    const e = new EmotionEngine({ ...NEUTRAL_EMOTION, curiosity: 0.9 });
    const s = e.applyAutonomous("observe");
    expect(s.curiosity).toBeLessThan(0.9);
  });

  it("interact（完成互动）：trust↑、loneliness↓", () => {
    const e = new EmotionEngine({ ...NEUTRAL_EMOTION, trust: 0.3, loneliness: 0.8 });
    const s = e.applyAutonomous("interact");
    expect(s.trust).toBeGreaterThan(0.3);
    expect(s.loneliness).toBeLessThan(0.8);
  });
});

describe("EmotionEngine · 夹紧边界", () => {
  it("反复触摸不会突破 [0,1]", () => {
    const e = new EmotionEngine();
    let s: EmotionState = e.getState();
    for (let i = 0; i < 50; i++) s = e.applyInteraction("touch");
    expect(s.comfort).toBeLessThanOrEqual(1);
    expect(s.trust).toBeLessThanOrEqual(1);
    expect(s.loneliness).toBeGreaterThanOrEqual(0);
  });

  it("状态始终有限（无 NaN）", () => {
    const e = new EmotionEngine();
    e.tick(1000, false);
    e.applyInteraction("touch");
    e.applyAutonomous("observe");
    const s = e.getState();
    expect(Number.isFinite(s.comfort)).toBe(true);
    expect(Number.isFinite(s.loneliness)).toBe(true);
    expect(Number.isFinite(s.curiosity)).toBe(true);
  });
});

describe("applyEmotionToTraits · 调制", () => {
  it("中性情绪 = 恒等（继承人格中性恒等原则）", () => {
    const t: PersonalityTraits = { ...NEUTRAL_TRAITS, curiosity: 0.9, patience: 0.3 };
    const out = applyEmotionToTraits(t, NEUTRAL_EMOTION);
    expect(out.curiosity).toBeCloseTo(0.9);
    expect(out.patience).toBeCloseTo(0.3);
    expect(out.sociability).toBeCloseTo(NEUTRAL_TRAITS.sociability);
  });

  it("孤独高 → sociability↑、expressiveness↑、independence↓", () => {
    const t = NEUTRAL_TRAITS;
    const lonely: EmotionState = { ...NEUTRAL_EMOTION, loneliness: 1 };
    const out = applyEmotionToTraits(t, lonely);
    expect(out.sociability).toBeGreaterThan(t.sociability);
    expect(out.expressiveness).toBeGreaterThan(t.expressiveness);
    expect(out.independence).toBeLessThan(t.independence);
  });

  it("comfort 高 → patience↑", () => {
    const t = NEUTRAL_TRAITS;
    const comfy: EmotionState = { ...NEUTRAL_EMOTION, comfort: 1 };
    const out = applyEmotionToTraits(t, comfy);
    expect(out.patience).toBeGreaterThan(t.patience);
  });

  it("调制结果仍被 clamp 到 [0,1]（极值不溢出）", () => {
    const t = NEUTRAL_TRAITS;
    const extreme: EmotionState = { comfort: 1, trust: 1, loneliness: 1, curiosity: 1 };
    const out = applyEmotionToTraits(t, extreme);
    expect(clampTraits(out)).toEqual(out); // 已在范围内
    for (const v of Object.values(out)) expect(v).toBeGreaterThanOrEqual(0) && expect(v).toBeLessThanOrEqual(1);
  });
});

describe("EmotionEngine · 整轮模拟（生命感）", () => {
  it("独处 5 分钟→摸摸它：loneliness 回落、comfort/trust 回升（恢复状态而非重启）", () => {
    const e = new EmotionEngine();
    const afterIdle = e.tick(5 * 60_000, false);
    expect(afterIdle.loneliness).toBeGreaterThan(0.7);
    const afterTouch = e.applyInteraction("touch");
    expect(afterTouch.loneliness).toBeLessThan(afterIdle.loneliness);
    expect(afterTouch.comfort).toBeGreaterThan(afterIdle.comfort);
    expect(afterTouch.trust).toBeGreaterThan(afterIdle.trust);
    // 不是重启：情绪是连续演化后的新状态，而非回到中性
    expect(afterTouch.loneliness).not.toBeCloseTo(NEUTRAL_EMOTION.loneliness);
  });
});
