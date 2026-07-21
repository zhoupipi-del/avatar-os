export function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}

export interface DrivePressures {
  fatiguePressure: number;   // 疲劳冲动 (0.0 ~ 1.0)
  lonelinessPressure: number;// 孤独冲动 (0.0 ~ 1.0)
  curiosityPressure: number; // 好奇冲动 (0.0 ~ 1.0)
}

export interface LifeState {
  energy: number;            // 0.0 ~ 1.0 基础能量
  socialNeed: number;        // 0.0 ~ 1.0 社交需求
  curiosity: number;         // 0.0 ~ 1.0 好奇度
  pressures: DrivePressures;
}

export const INITIAL_LIFE_STATE: LifeState = {
  energy: 1.0,
  socialNeed: 0.2,
  curiosity: 0.5,
  pressures: {
    fatiguePressure: 0.0,
    lonelinessPressure: 0.0,
    curiosityPressure: 0.0,
  },
};
