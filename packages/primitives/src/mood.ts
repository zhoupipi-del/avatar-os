export enum Mood {
  CALM = "CALM",         // 平静
  CURIOUS = "CURIOUS",   // 好奇
  HAPPY = "HAPPY",       // 开心
  EXCITED = "EXCITED",   // 兴奋
  TIRED = "TIRED",       // 疲惫
  FOCUSED = "FOCUSED",   // 专注
  LONELY = "LONELY",     // 孤独
  PLAYFUL = "PLAYFUL",   // 调皮
  SAD = "SAD",           // 沮丧
  SLEEPING = "SLEEPING", // 沉睡
}

export interface MoodState {
  current: Mood;
  intensity: number; // 0.0 - 1.0 情绪浓度
  durationMs?: number;
}
