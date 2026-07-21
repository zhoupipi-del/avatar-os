// ============================================================
// DriveEngine — 需求→压力 生理时钟 (v0.1.0-alpha Life Closed-Loop)
// ============================================================
// P0 原地升舱（不另起 drive-engine-v2.ts，避免双实现陷阱）：
//   - 输入由伪造 DesktopContext 改为真实 UserPresence + PersonalityVector
//     + recentInteractionBonus（来自记忆内核）。
//   - 内部 hoursFactor 锁：把 deltaMs 换算成"小时"做生理速率积分，
//     保证分钟级 tick 与小时级生理曲线尺度一致（修复原版分钟尺度下
//     累积速率过弱、记忆衰减反而归零的悖论）。
//   - 输出 { state: LifeState; emotionalState: EmotionalState }，
//     情绪用 PAD 三轴表达，供 Morphology / MemoryKernel 消费。
// ============================================================

import { EmotionalState, LifeState, clamp01 } from "@avatar-os/primitives";
import { UserPresence } from "@avatar-os/sensor";
import { PersonalityVector } from "./personality";

const HOUR_MS = 3_600_000;

export class DriveEngine {
  private state: LifeState;
  /** 社交需求初始种子：冷启动即有轻微社交基线，避免永远为 0 */
  private readonly socialNeedSeed = 0.3;

  constructor(initialState?: Partial<LifeState>) {
    this.state = {
      energy: initialState?.energy ?? 1.0,
      socialNeed: initialState?.socialNeed ?? this.socialNeedSeed,
      curiosity: initialState?.curiosity ?? 0.5,
      pressures: initialState?.pressures ?? {
        fatiguePressure: 0.0,
        lonelinessPressure: 0.0,
        curiosityPressure: 0.0,
      },
    };
  }

  public getState(): LifeState {
    return { ...this.state };
  }

  /**
   * 自然时钟演算：计算 Need -> Pressure 的动态演化。
   * @returns 演化后的生命状态 + PAD 情绪状态
   */
  public tick(
    deltaMs: number,
    presence: UserPresence,
    personality: PersonalityVector,
    recentInteractionBonus: number,
  ): { state: LifeState; emotionalState: EmotionalState } {
    // 内部锁：把 tick 间隔换算成"小时"做生理速率积分
    const hoursFactor = deltaMs / HOUR_MS;

    const hour = new Date().getHours();
    const isNight = hour >= 23 || hour < 6;

    // 1. 能量随时间消耗，夜间消耗更快；稳定性高的人耗得慢
    const energyDecayRate = (isNight ? 0.25 : 0.08) / personality.stability;
    this.state.energy = clamp01(this.state.energy - energyDecayRate * hoursFactor);

    // 2. 长期无人理睬（在场强度低）→ 社交需求累积，速率随外向性放大
    const isolationFactor = 1.0 - presence.level;
    const socialAccumulationRate = 1.5 * personality.extraversion;
    this.state.socialNeed = clamp01(
      this.state.socialNeed + isolationFactor * socialAccumulationRate * hoursFactor,
    );

    // 3. 记忆甜度对孤独压力的乘性衰减：最近互动越多/越依恋，缓解越强
    const memoryDampening = 1.0 - recentInteractionBonus * personality.attachment * 0.5;
    const rawLonelinessPressure = this.state.socialNeed * isolationFactor;
    const lonelinessPressure = clamp01(rawLonelinessPressure * memoryDampening);

    // 4. 疲劳压力：能量越低越累，夜间加权
    const fatiguePressure = clamp01((1.0 - this.state.energy) * (isNight ? 1.5 : 1.0));

    // 5. 好奇压力：开放性格 + 用户在场 → 想探索
    const curiosityPressure = clamp01(personality.openness * presence.level);

    this.state.pressures = { fatiguePressure, lonelinessPressure, curiosityPressure };

    // 6. PAD 情绪三轴（供 Morphology / MemoryKernel 消费）
    const emotionalState: EmotionalState = {
      valence: clamp01(0.5 + this.state.energy * 0.5 - lonelinessPressure * 0.4),
      arousal: clamp01(curiosityPressure * 0.7 + (1.0 - fatiguePressure) * 0.3),
      stability: personality.stability,
    };

    return { state: this.getState(), emotionalState };
  }
}

export const driveEngine = new DriveEngine();
