// ============================================================
// Personality · Behavior Tuning (v0.3.6-B)
// ============================================================
// 人格内核：让同一生命状态在不同性格下产生不同的自主行为节奏。
//
// 单向链路（与开工契约一致）：
//   Personality Profile → PersonalityTraits → BehaviorTuning → AutonomousScheduler → PhysicalIntent
//
// 设计纪律：
//   1. 人格只"调音"——调概率 / 冷却 / 偏好，绝不绕过调度器直接发意图。
//      这样不会重新制造意图风暴（v0.3.6-A 已根除）。
//   2. 与身体完全解耦：本模块不 import 任何 avatarId / clip 名 / 渲染层。
//      BAG 与 Warrior 消费同一份 Profile，零特判。
//   3. 安全边界不可突破：applyTuning 在最后一步把冷却夹紧到各自底线，
//      无论人格参数多极端，以下规则恒成立：
//        全局 one-shot 间隔 ≥ 15s（调度器逻辑保证）
//        STRETCH 实际冷却     ≥ 240s
//        PEEK   实际冷却     ≥ 20s
//        lonely-look 实际冷却 ≥ 15s
//        用户打断静默窗       ≥ 6s（调度器逻辑保证）
//        active / sleeping   禁止自主 one-shot（调度器硬闸）
//        clip 播放期间        禁止插入（调度器硬闸）
//        AI 与 SENSOR 用户意图 均可立即打断（调度器逻辑保证）
// ============================================================

import type { AutonomousBehaviorDef } from "../life/autonomous-scheduler";

/** 第一版人格维度（v0.3.6-B）。统一限制 0..1。暂不引入 humor（留待 Speech Personality 阶段）。 */
export interface PersonalityTraits {
  /** 好奇程度：驱动观察/偷看(PEEK)倾向 */
  curiosity: number;
  /** 亲近用户的倾向：驱动 lonely 阶段看向用户(LOOK_AT_USER) */
  sociability: number;
  /** 安静等待与动作克制度：高 → one-shot 更少 */
  patience: number;
  /** 独立活动倾向：高 → 减少面向用户动作、保留自发伸展 */
  independence: number;
  /** 动作表现强度：在安全范围内提高动作触发倾向 */
  expressiveness: number;
}

/** 中性基线：所有维度 0.5。人格调音相对它计算乘子，中性人格 → 所有乘子 = 1.0。 */
export const NEUTRAL_TRAITS: PersonalityTraits = {
  curiosity: 0.5,
  sociability: 0.5,
  patience: 0.5,
  independence: 0.5,
  expressiveness: 0.5,
};

/** 把任意输入夹紧到 0..1（非有限值回落中性 0.5），杜绝 NaN / 越界。 */
export function clampTraits(t: PersonalityTraits): PersonalityTraits {
  const c = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0.5));
  return {
    curiosity: c(t.curiosity),
    sociability: c(t.sociability),
    patience: c(t.patience),
    independence: c(t.independence),
    expressiveness: c(t.expressiveness),
  };
}

export type PersonalityProfileId =
  | "companion-default"
  | "curious-explorer"
  | "quiet-observer";

export const DEFAULT_PERSONALITY_PROFILE_ID: PersonalityProfileId = "companion-default";

/**
 * 第一版内置配置（便于真机对比三种体感）：
 *   companion-default  好奇、友好、动作适中（= 中性基线，保证 v0.3.6-A 冻结参数不被改）
 *   curious-explorer   更频繁观察探索，独立性强
 *   quiet-observer     动作克制、耐心、较少主动打扰
 */
export const BUILTIN_PERSONALITY_PROFILES: Record<PersonalityProfileId, PersonalityTraits> = {
  "companion-default": {
    curiosity: 0.5,
    sociability: 0.5,
    patience: 0.5,
    independence: 0.5,
    expressiveness: 0.5,
  },
  "curious-explorer": {
    curiosity: 0.9,
    sociability: 0.7,
    patience: 0.4,
    independence: 0.85,
    expressiveness: 0.75,
  },
  "quiet-observer": {
    curiosity: 0.4,
    sociability: 0.3,
    patience: 0.92,
    independence: 0.5,
    expressiveness: 0.2,
  },
};

/** 人格只生成一个派生策略；调度器消费它。 */
export interface AutonomousBehaviorTuning {
  peekChanceMultiplier: number;
  peekCooldownMultiplier: number;
  stretchChanceMultiplier: number;
  stretchCooldownMultiplier: number;
  lonelyLookChanceMultiplier: number;
  lonelyLookCooldownMultiplier: number;
  /** 面向用户的复合权重：sociability 升、independence 降；单独驱动 lonely-look 强度。 */
  userFocusWeight: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** 相对中性基线的偏移量（d(0.5)=0） */
const d = (v: number) => v - 0.5;

/**
 * 由人格推导行为调音策略。所有乘子相对中性基线(0.5)计算，中性人格 → 全部 1.0。
 * 语义对应开工契约示例：
 *   高 curiosity  → PEEK 概率上升、冷却适度缩短
 *   高 patience   → one-shot 更少、STRETCH 冷却延长
 *   高 sociability→ lonely 时更愿意看向用户
 *   高 independence→ 减少面向用户动作、保留自发伸展
 *   高 expressiveness → 在安全范围内提高动作触发倾向
 */
export function deriveBehaviorTuning(t: PersonalityTraits): AutonomousBehaviorTuning {
  const x = clampTraits(t);
  return {
    peekChanceMultiplier: clamp(1 + 1.6 * d(x.curiosity) + 0.4 * d(x.expressiveness) - 0.8 * d(x.independence), 0.2, 2.5),
    peekCooldownMultiplier: clamp(1 - 0.9 * d(x.curiosity) + 0.5 * d(x.independence), 0.83, 2),
    stretchChanceMultiplier: clamp(1 + 0.7 * d(x.expressiveness) - 0.6 * d(x.patience) + 0.3 * d(x.independence), 0.2, 2),
    stretchCooldownMultiplier: clamp(1 + 1.2 * d(x.patience) - 0.2 * d(x.expressiveness), 1, 2),
    lonelyLookChanceMultiplier: clamp(1 + 1.0 * d(x.sociability), 0.2, 2),
    lonelyLookCooldownMultiplier: clamp(1 - 0.6 * d(x.sociability), 0.7, 2),
    // 中性基线 = 1.0（不衰减 lonely-look 概率），保证中性人格对 lonely-wait 是恒等变换。
  userFocusWeight: clamp(1 + 0.8 * d(x.sociability) - 1.2 * d(x.independence), 0.05, 2.5),
  };
}

/** 安全底线（不随人格突破） */
export const PEEK_MIN_COOLDOWN_MS = 20_000;
export const STRETCH_MIN_COOLDOWN_MS = 240_000;
export const LONELY_LOOK_MIN_COOLDOWN_MS = 15_000;

/**
 * 把人格派生调音应用到基础行为表，产出调度器实际使用的有效行为表。
 * 安全夹紧：chance ∈ [0,1]；cooldown ≥ 各自底线。全局 one-shot 间隔由调度器逻辑保证。
 */
export function applyTuning(
  base: readonly AutonomousBehaviorDef[],
  tuning: AutonomousBehaviorTuning,
): AutonomousBehaviorDef[] {
  const effective = base.map((b): AutonomousBehaviorDef => {
    let chance = b.chancePerTick;
    let cooldown = b.cooldownMs;
    if (b.id === "curious-peek") {
      chance = b.chancePerTick * tuning.peekChanceMultiplier;
      cooldown = b.cooldownMs * tuning.peekCooldownMultiplier;
    } else if (b.id === "idle-stretch") {
      chance = b.chancePerTick * tuning.stretchChanceMultiplier;
      cooldown = b.cooldownMs * tuning.stretchCooldownMultiplier;
    } else if (b.id === "lonely-wait") {
      // lonely-look 同时受 sociability(显式乘子) 与 userFocusWeight(面向用户复合) 调制
      chance = b.chancePerTick * tuning.lonelyLookChanceMultiplier * tuning.userFocusWeight;
      cooldown = b.cooldownMs * tuning.lonelyLookCooldownMultiplier;
    }
    return { ...b, chancePerTick: clamp(chance, 0, 1), cooldownMs: Math.max(0, Math.round(cooldown)) };
  });

  // 防御性底线夹紧：即使调音算错也不突破契约安全边界。
  return effective.map((b): AutonomousBehaviorDef => {
    if (b.id === "curious-peek") return { ...b, cooldownMs: Math.max(b.cooldownMs, PEEK_MIN_COOLDOWN_MS) };
    if (b.id === "idle-stretch") return { ...b, cooldownMs: Math.max(b.cooldownMs, STRETCH_MIN_COOLDOWN_MS) };
    if (b.id === "lonely-wait") return { ...b, cooldownMs: Math.max(b.cooldownMs, LONELY_LOOK_MIN_COOLDOWN_MS) };
    return b;
  });
}

/** 若 traits 与某内置 Profile 完全一致，返回其 id，否则 null（用于可观测性标注）。 */
export function resolveProfileId(traits: PersonalityTraits): PersonalityProfileId | null {
  const t = clampTraits(traits);
  for (const id of Object.keys(BUILTIN_PERSONALITY_PROFILES) as PersonalityProfileId[]) {
    const p = BUILTIN_PERSONALITY_PROFILES[id];
    if (
      p.curiosity === t.curiosity &&
      p.sociability === t.sociability &&
      p.patience === t.patience &&
      p.independence === t.independence &&
      p.expressiveness === t.expressiveness
    ) {
      return id;
    }
  }
  return null;
}
