// ============================================================
// EmotionalState — PAD 情绪三轴模型 (v0.1.0-alpha)
// ============================================================
// PAD = Pleasure-Arousal-Dominance，经典情绪维度空间：
//   - valence (愉悦度): -1.0(极度不悦) ~ +1.0(极度愉悦)
//   - arousal (唤醒度):  0.0(沉睡) ~ 1.0(极度亢奋)
//   - stability (稳定度): 0.0(情绪崩溃/剧烈波动) ~ 1.0(极度稳定)
//
// 三轴从 LifeState + Personality 计算，供 DriveEngine / MemoryKernel 消费，
// 最终影响 PhysicalIntent 的 priority/clamping 与 BehaviorVM 的行为选择。
// ============================================================

export interface EmotionalState {
  valence: number;   // -1.0 ~ 1.0
  arousal: number;   //  0.0 ~ 1.0
  stability: number; //  0.0 ~ 1.0
}

/**
 * NEUTRAL_EMOTIONAL_STATE — 默认中性情绪（系统初始化 / 复位态）。
 */
export const NEUTRAL_EMOTIONAL_STATE: EmotionalState = {
  valence: 0.0,
  arousal: 0.3,
  stability: 1.0,
};
