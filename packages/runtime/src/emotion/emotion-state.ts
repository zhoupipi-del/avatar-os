// ============================================================
// Emotion · State (v0.3.6-C)
// ============================================================
// 情绪内核：给"行为倾向"叠加"经历后的内部状态"。
//
// 单向链路（与开工契约一致）：
//   Experience/Event → EmotionState → PersonalityTraits(调制) → BehaviorTuning → Scheduler → Intent
//
// 设计纪律（铁律，与人格层一致）：
//   1. 情绪**绝不**直接发意图。它只能调制 PersonalityTraits，再由 Personality 走
//      deriveBehaviorTuning → applyTuning → AutonomousScheduler 那条既有的、唯一的发射口。
//      这样情绪永远不会绕过 Scheduler，也不会与自主行为抢控制权。
//   2. 与身体完全解耦：本模块不 import 任何 avatarId / clip 名 / 渲染层。
//   3. 中性情绪恒等：applyEmotionToTraits 在 e=NEUTRAL_EMOTION 时必须返回原 traits，
//      即"没有情绪经历时，行为与 v0.3.6-B 完全一致"。这是继承人格中性恒等原则的延伸。
// ============================================================

import type { PersonalityTraits } from "../personality/behavior-tuning";
import { clampTraits } from "../personality/behavior-tuning";

/**
 * 第一版情绪维度（v0.3.6-C）。统一限制 0..1。
 * 全部是"内部状态"，不是动作指令。
 */
export interface EmotionState {
  /** 舒适：被陪伴/环境安全 → 上升；久无人 → 下降 */
  comfort: number;
  /** 信任：用户持续互动（摸摸它/聊天/它主动看用户被回应）→ 上升 */
  trust: number;
  /** 孤独：无人陪伴随时间上升；互动/被陪伴 → 下降 */
  loneliness: number;
  /** 好奇：独处时缓慢上升；主动观察(PEEK/STRETCH)后短暂满足而下降 */
  curiosity: number;
}

/** 中性基线：所有维度 0.5。情绪调制相对它计算偏移，中性情绪 → 对人格零偏移（恒等）。 */
export const NEUTRAL_EMOTION: EmotionState = {
  comfort: 0.5,
  trust: 0.5,
  loneliness: 0.5,
  curiosity: 0.5,
};

/** 把任意输入夹紧到 0..1（非有限值回落中性 0.5），杜绝 NaN / 越界。 */
export function clampEmotion(e: EmotionState): EmotionState {
  const c = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0.5));
  return {
    comfort: c(e.comfort),
    trust: c(e.trust),
    loneliness: c(e.loneliness),
    curiosity: c(e.curiosity),
  };
}

/** 创建一份初始情绪（默认中性；可在启动时覆盖，例如"刚见面"给较低 loneliness）。 */
export function createInitialEmotion(override?: Partial<EmotionState>): EmotionState {
  return clampEmotion({ ...NEUTRAL_EMOTION, ...(override ?? {}) });
}

/**
 * 情绪 → 人格 调制：返回被情绪偏移后的有效 PersonalityTraits。
 *
 * 关键设计：以中性情绪为恒等原点（offset = e - 0.5）。
 *   - e === NEUTRAL_EMOTION（所有 offset = 0）→ 返回 clampTraits(traits) 原值，v0.3.6-B 行为不变。
 *   - loneliness 高 → sociability↑ / expressiveness↑ / independence↓（更想看用户、更黏、更不独立）
 *   - comfort 高    → patience↑（更安静等待）
 *   - curiosity(情绪) 高 → curiosity(人格)↑（更想探索）
 *   - trust 高      → sociability↑（更愿亲近）
 *
 * 调制幅度由下方权重常数控制，集中便于 BOSS 调参。权重取 0..1 之间，保证偏移有界、不把极端情绪
 * 扭曲成相反人格。
 */
const W_CURIOSITY = 0.6; // 情绪 curiosity → 人格 curiosity
const W_SOCIABILITY = 0.6; // (loneliness + trust) 偏移 → 人格 sociability
const W_PATIENCE = 0.4; // comfort 偏移 → 人格 patience
const W_INDEPENDENCE = 0.4; // loneliness 偏移 → 人格 independence（反向）
const W_EXPRESSIVENESS = 0.5; // loneliness 偏移 → 人格 expressiveness

export function applyEmotionToTraits(t: PersonalityTraits, e: EmotionState): PersonalityTraits {
  const off = (v: number) => v - 0.5; // 相对中性基线的偏移
  const em = clampEmotion(e);
  return clampTraits({
    curiosity: t.curiosity + off(em.curiosity) * W_CURIOSITY,
    sociability: t.sociability + ((off(em.loneliness) + off(em.trust)) / 2) * W_SOCIABILITY,
    patience: t.patience + off(em.comfort) * W_PATIENCE,
    independence: t.independence - off(em.loneliness) * W_INDEPENDENCE,
    expressiveness: t.expressiveness + off(em.loneliness) * W_EXPRESSIVENESS,
  });
}
