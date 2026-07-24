// ============================================================
// Personality · Behavior Tuning 单测 (v0.3.6-B)
// 覆盖开工契约的可测项：
//   特征夹紧 / 中性恒等 / 安全底线不可突破 / 调音语义 /
//   内置 Profile 解析 / 确定性
// ============================================================

import { describe, it, expect } from "vitest";
import {
  NEUTRAL_TRAITS,
  clampTraits,
  BUILTIN_PERSONALITY_PROFILES,
  DEFAULT_PERSONALITY_PROFILE_ID,
  deriveBehaviorTuning,
  applyTuning,
  resolveProfileId,
  PEEK_MIN_COOLDOWN_MS,
  STRETCH_MIN_COOLDOWN_MS,
  LONELY_LOOK_MIN_COOLDOWN_MS,
  type PersonalityTraits,
} from "./behavior-tuning";
import { DEFAULT_AUTONOMOUS_BEHAVIORS } from "../life/autonomous-scheduler";

const ALL_ONES: PersonalityTraits = {
  curiosity: 1,
  sociability: 1,
  patience: 1,
  independence: 1,
  expressiveness: 1,
};
const ALL_ZEROS: PersonalityTraits = {
  curiosity: 0,
  sociability: 0,
  patience: 0,
  independence: 0,
  expressiveness: 0,
};
const traits = (over: Partial<PersonalityTraits>): PersonalityTraits => ({ ...NEUTRAL_TRAITS, ...over });

describe("clampTraits — 特征夹紧 0..1", () => {
  it("越界值被夹回 [0,1]", () => {
    const c = clampTraits({ curiosity: 2, sociability: -1, patience: 5, independence: -9, expressiveness: 0.5 });
    expect(c).toEqual({ curiosity: 1, sociability: 0, patience: 1, independence: 0, expressiveness: 0.5 });
  });

  it("NaN / 非有限值(含 ±Infinity)统一回落中性 0.5", () => {
    const c = clampTraits({
      curiosity: NaN,
      sociability: Infinity,
      patience: -Infinity,
      independence: Number("abc"),
      expressiveness: 0.5,
    });
    // clampTraits 对非有限值一律回落 0.5（不夹到边界），杜绝任何非有限值渗入调度器
    expect(c.curiosity).toBe(0.5);
    expect(c.sociability).toBe(0.5);
    expect(c.patience).toBe(0.5);
    expect(c.independence).toBe(0.5);
    expect(c.expressiveness).toBe(0.5);
  });
});

describe("中性人格 = 恒等变换（不改动 v0.3.6-A 冻结参数）", () => {
  it("deriveBehaviorTuning(中性) → 全部乘子 = 1.0", () => {
    const t = deriveBehaviorTuning(NEUTRAL_TRAITS);
    expect(t.peekChanceMultiplier).toBe(1);
    expect(t.peekCooldownMultiplier).toBe(1);
    expect(t.stretchChanceMultiplier).toBe(1);
    expect(t.stretchCooldownMultiplier).toBe(1);
    expect(t.lonelyLookChanceMultiplier).toBe(1);
    expect(t.lonelyLookCooldownMultiplier).toBe(1);
    expect(t.userFocusWeight).toBe(1);
  });

  it("applyTuning(默认表, 中性调音) 深等于默认冻结参数", () => {
    const effective = applyTuning(DEFAULT_AUTONOMOUS_BEHAVIORS, deriveBehaviorTuning(NEUTRAL_TRAITS));
    expect(effective).toEqual(DEFAULT_AUTONOMOUS_BEHAVIORS);
  });
});

describe("安全底线不可突破（无论人格多极端）", () => {
  it("ALL_ONES 极端人格：冷却仍被夹到各自底线、概率 ∈ [0,1]", () => {
    const eff = applyTuning(DEFAULT_AUTONOMOUS_BEHAVIORS, deriveBehaviorTuning(ALL_ONES));
    const byId = Object.fromEntries(eff.map((b) => [b.id, b]));
    expect(byId["curious-peek"].cooldownMs).toBeGreaterThanOrEqual(PEEK_MIN_COOLDOWN_MS);
    expect(byId["idle-stretch"].cooldownMs).toBeGreaterThanOrEqual(STRETCH_MIN_COOLDOWN_MS);
    expect(byId["lonely-wait"].cooldownMs).toBeGreaterThanOrEqual(LONELY_LOOK_MIN_COOLDOWN_MS);
    for (const b of eff) {
      expect(b.chancePerTick).toBeGreaterThanOrEqual(0);
      expect(b.chancePerTick).toBeLessThanOrEqual(1);
    }
  });

  it("ALL_ZEROS 极端人格：同底线、概率 ∈ [0,1]", () => {
    const eff = applyTuning(DEFAULT_AUTONOMOUS_BEHAVIORS, deriveBehaviorTuning(ALL_ZEROS));
    const byId = Object.fromEntries(eff.map((b) => [b.id, b]));
    expect(byId["curious-peek"].cooldownMs).toBeGreaterThanOrEqual(PEEK_MIN_COOLDOWN_MS);
    expect(byId["idle-stretch"].cooldownMs).toBeGreaterThanOrEqual(STRETCH_MIN_COOLDOWN_MS);
    expect(byId["lonely-wait"].cooldownMs).toBeGreaterThanOrEqual(LONELY_LOOK_MIN_COOLDOWN_MS);
    for (const b of eff) {
      expect(b.chancePerTick).toBeGreaterThanOrEqual(0);
      expect(b.chancePerTick).toBeLessThanOrEqual(1);
    }
  });
});

describe("调音语义（人格 → 行为节奏方向正确）", () => {
  it("高 curiosity → PEEK 概率更高、冷却更短", () => {
    const hi = deriveBehaviorTuning(traits({ curiosity: 0.9 }));
    const lo = deriveBehaviorTuning(traits({ curiosity: 0.1 }));
    expect(hi.peekChanceMultiplier).toBeGreaterThan(lo.peekChanceMultiplier);
    expect(hi.peekCooldownMultiplier).toBeLessThan(lo.peekCooldownMultiplier);
  });

  it("高 patience → STRETCH 概率更低（one-shot 更少）", () => {
    const hi = deriveBehaviorTuning(traits({ patience: 0.95 }));
    const lo = deriveBehaviorTuning(traits({ patience: 0.05 }));
    expect(hi.stretchChanceMultiplier).toBeLessThan(lo.stretchChanceMultiplier);
  });

  it("高 sociability → lonely-look 概率更高", () => {
    const hi = deriveBehaviorTuning(traits({ sociability: 0.95 }));
    const lo = deriveBehaviorTuning(traits({ sociability: 0.05 }));
    expect(hi.lonelyLookChanceMultiplier).toBeGreaterThan(lo.lonelyLookChanceMultiplier);
  });

  it("高 independence → 面向用户权重更低、PEEK 冷却更长（更少面向用户动作）", () => {
    const hi = deriveBehaviorTuning(traits({ independence: 0.95 }));
    const lo = deriveBehaviorTuning(traits({ independence: 0.05 }));
    expect(hi.userFocusWeight).toBeLessThan(lo.userFocusWeight);
    expect(hi.peekCooldownMultiplier).toBeGreaterThan(lo.peekCooldownMultiplier);
  });
});

describe("内置 Profile 解析与确定性", () => {
  it("内置 Profile 可被 resolveProfileId 识别", () => {
    expect(resolveProfileId(BUILTIN_PERSONALITY_PROFILES["companion-default"])).toBe("companion-default");
    expect(resolveProfileId(BUILTIN_PERSONALITY_PROFILES["curious-explorer"])).toBe("curious-explorer");
    expect(resolveProfileId(BUILTIN_PERSONALITY_PROFILES["quiet-observer"])).toBe("quiet-observer");
  });

  it("非内置 traits → null", () => {
    expect(resolveProfileId(traits({ curiosity: 0.73 }))).toBeNull();
  });

  it("同一输入 → 同一调音（确定性）", () => {
    const a = deriveBehaviorTuning(BUILTIN_PERSONALITY_PROFILES["curious-explorer"]);
    const b = deriveBehaviorTuning(BUILTIN_PERSONALITY_PROFILES["curious-explorer"]);
    expect(a).toEqual(b);
  });

  it("默认 Profile id 合法存在", () => {
    expect(BUILTIN_PERSONALITY_PROFILES[DEFAULT_PERSONALITY_PROFILE_ID]).toBeDefined();
  });
});
