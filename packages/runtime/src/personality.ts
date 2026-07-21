// ============================================================
// PersonalityVector — 性格向量 (v0.1.0-alpha Life Closed-Loop)
// ============================================================
// 性格是「需求→压力」生理曲线的调制器：
//   - openness   开放性：好奇冲动的来源强度（curiosityPressure 系数）
//   - extraversion 外向性：社交需求累积速率（socialAccumulationRate 系数）
//   - stability 稳定性：能量消耗速率的分母 + PAD 稳定轴
//   - attachment 依恋性：记忆甜度对孤独压力的衰减强度（memoryDampening 系数）
//
// 该类型与默认值集中于此，供 DriveEngine / Morphology / BehaviorVM 复用，
// 杜绝在 drive-engine 内联字面量造成的不一致。
// ============================================================

export interface PersonalityVector {
  openness: number; //   0.0 ~ 1.0
  extraversion: number; // 0.0 ~ 1.0
  stability: number; //  0.0 ~ 1.0
  attachment: number; // 0.0 ~ 1.0
}

/**
 * DEFAULT_PERSONALITY — BOSS 默认陪伴型人格：
 *   偏外向(0.6) → 容易想念用户；高稳定(0.8) → 能耗慢、情绪稳；
 *   高依恋(0.85) → 最近的互动能显著缓解孤独；中高开放(0.7) → 保持好奇。
 */
export const DEFAULT_PERSONALITY: PersonalityVector = {
  openness: 0.7,
  extraversion: 0.6,
  stability: 0.8,
  attachment: 0.85,
};
