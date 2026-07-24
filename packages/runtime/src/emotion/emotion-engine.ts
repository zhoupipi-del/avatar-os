// ============================================================
// Emotion · Engine (v0.3.6-C)
// ============================================================
// 情绪演化引擎：根据"事件"和"时间流逝"推进 EmotionState。
//
// 纯逻辑、零总线依赖（与 AutonomousScheduler 同纪律）：演进规则内聚，外部注入事件。
// 铁律：本引擎**没有任何 emit / dispatch / 发意图的方法**——它只维护内部状态。
//       情绪对外的影响通过 life-loop 读取 getState() → applyEmotionToTraits → 调度器 实现。
//
// 调参指南（下方常量集中，便于 BOSS 调手感）：
//   - 单次互动增量：用户每次"摸摸它"/"聊天"给多大情绪波动。
//   - 自主行为反馈：它自己偷看/伸展(observe)或成功看向用户(interact)的满足感。
//   - 时间演化速率：无人陪伴随时间怎么变；有人在场怎么恢复。
// ============================================================

import {
  type EmotionState,
  NEUTRAL_EMOTION,
  clampEmotion,
} from "./emotion-state";

/** 用户互动类型（来自既有事件，不新增交互通道）。 */
export type EmotionInteraction = "touch" | "speak";

/** 自主行为反馈类型（由自主行为起始边沿驱动）。 */
export type EmotionAutonomous = "observe" | "interact";

// —— 单次互动增量（事件驱动，绝对增量；最终由 clampEmotion 约束到 [0,1]）——
const TOUCH_DELTA: EmotionState = { comfort: +0.18, trust: +0.12, loneliness: -0.25, curiosity: 0 };
const SPEAK_DELTA: EmotionState = { comfort: +0.08, trust: +0.10, loneliness: -0.08, curiosity: 0 };

// —— 自主行为反馈增量 ——
// observe：主动观察(PEEK/STRETCH)发生 → curiosity 被满足而短暂下降，顺带一点 comfort。
const OBSERVE_DELTA: EmotionState = { comfort: +0.03, trust: 0, loneliness: 0, curiosity: -0.12 };
// interact：它主动看向用户且用户在场(完成一次互动) → trust 上升、孤独缓解。
const INTERACT_DELTA: EmotionState = { comfort: +0.04, trust: +0.06, loneliness: -0.05, curiosity: 0 };

// —— 时间演化速率（单位：每秒）——
// 无人陪伴：孤独缓升、舒适缓降、好奇因无聊缓升。
const IDLE_PER_SEC: EmotionState = { comfort: -0.006, trust: 0, loneliness: +0.010, curiosity: +0.004 };
// 用户在场：孤独缓降、舒适缓升、好奇因被满足缓降。
const PRESENT_PER_SEC: EmotionState = { comfort: +0.006, trust: 0, loneliness: -0.015, curiosity: -0.003 };

function add(a: EmotionState, b: EmotionState): EmotionState {
  return clampEmotion({
    comfort: a.comfort + b.comfort,
    trust: a.trust + b.trust,
    loneliness: a.loneliness + b.loneliness,
    curiosity: a.curiosity + b.curiosity,
  });
}

export interface AttachmentModulation {
  /** 用户离开（不在场）时，loneliness 上升速率乘子（attachment 高 → 略 >1）。 */
  leaveLonelinessMul: number;
  /** 用户回来（在场）时，comfort 恢复速率乘子（attachment 高 → 略 >1）。 */
  returnComfortMul: number;
}

export class EmotionEngine {
  private state: EmotionState;
  /** 依恋速率调制：中性关系 = {1,1}，对 v0.3.6-C 动力学零影响。 */
  private attachmentMod: AttachmentModulation = { leaveLonelinessMul: 1, returnComfortMul: 1 };

  constructor(initial?: EmotionState) {
    this.state = clampEmotion(initial ?? NEUTRAL_EMOTION);
  }

  /** 只读镜像当前情绪。 */
  getState(): EmotionState {
    return { ...this.state };
  }

  /**
   * 以给定状态为起点（v0.3.7-A 关系基线接入点）。
   * 中性关系 → 传入 NEUTRAL_EMOTION = 恒等，v0.3.6-C 行为完全不变。
   * 仅在加载关系后调用一次，绝不每 tick 重置当前情绪。
   */
  seed(state: EmotionState): void {
    this.state = clampEmotion(state);
  }

  /** 设置依恋速率调制（attachment 高 → 离开 loneliness 升更快 / 回来 comfort 恢复更快）。中性 = {1,1}。 */
  setAttachmentModulation(m: AttachmentModulation): void {
    this.attachmentMod = {
      leaveLonelinessMul: m.leaveLonelinessMul,
      returnComfortMul: m.returnComfortMul,
    };
  }

  /** 用户互动：摸摸它(touch) 或 聊天(speak)。返回新状态。 */
  applyInteraction(kind: EmotionInteraction): EmotionState {
    const delta = kind === "touch" ? TOUCH_DELTA : SPEAK_DELTA;
    this.state = add(this.state, delta);
    return this.getState();
  }

  /** 自主行为反馈：偷看/伸展(observe) 或 成功看向用户(interact)。返回新状态。 */
  applyAutonomous(kind: EmotionAutonomous): EmotionState {
    const delta = kind === "observe" ? OBSERVE_DELTA : INTERACT_DELTA;
    this.state = add(this.state, delta);
    return this.getState();
  }

  /**
   * 时间流逝推进。userPresent=true 表示用户当前在场（被陪伴），走恢复速率；否则走独处速率。
   * deltaMs 为距上次推进的毫秒数。返回新状态。
   */
  tick(deltaMs: number, userPresent: boolean): EmotionState {
    const sec = Math.max(0, deltaMs) / 1000;
    const rate = userPresent ? PRESENT_PER_SEC : IDLE_PER_SEC;
    // 依恋速率调制仅在 attachment>0 时偏离 1；中性关系恒等（v0.3.6-C 行为不变）
    const leaveMul = userPresent ? 1 : this.attachmentMod.leaveLonelinessMul;
    const returnMul = userPresent ? this.attachmentMod.returnComfortMul : 1;
    const scaled: EmotionState = {
      comfort: rate.comfort * sec * returnMul,
      trust: rate.trust * sec,
      loneliness: rate.loneliness * sec * leaveMul,
      curiosity: rate.curiosity * sec,
    };
    this.state = add(this.state, scaled);
    return this.getState();
  }
}
