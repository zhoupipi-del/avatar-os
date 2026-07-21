// ============================================================
// @avatar-os/morphology — 形态映射层 (v0.2.0-alpha)
// ============================================================
// Morphology 是「Arbiter 仲裁出的 PhysicalIntent + LifeState + 情绪」
// 到「渲染参数 RenderParams」的唯一翻译层。它不持有生命状态，只把
// 内核决策外化为可渲染的视觉协议：动作类(motion)、眼开合比、
// 躯体缩放、视线偏置。
//
// 依赖约束：本包只依赖 @avatar-os/primitives（类型），绝不依赖
// @avatar-os/runtime，以避免 runtime<->morphology 环形引用。
// 当前意图由 life-loop 经 setIntent() 显式注入。
// ============================================================

import {
  LifeState,
  EmotionalState,
  PhysicalIntent,
  PhysicalIntentType,
  clamp01,
} from "@avatar-os/primitives";

/** 渲染参数：Morphology 对外的唯一产物 */
export interface RenderParams {
  /** CSS 动画类 key（与 Body.tsx 的 motion-<key> 对应） */
  motion: string;
  /** 眼开合比 0.0(闭合) ~ 1.0(全开) */
  eyeOpenRatio: number;
  /** 躯体缩放（基线 1.0） */
  bodyScale: number;
  /** 视线偏置：情绪外化的微表情位移 */
  gazeBias: { x: number; y: number };
}

/** PhysicalIntent → 渲染动作类 映射（纯动作不影响 Mood，这里只管视觉） */
export const INTENT_TO_MOTION: Record<PhysicalIntentType, string> = {
  IDLE_BREATHE: "BREATH",
  LOOK_AT_USER: "LOOK",
  DOZE: "DOZE",
  STRETCH: "STRETCH",
  GREET: "GREET",
  PEEK: "PEEK",
  BOUNCE_HAPPY: "BOUNCE",
};

export class MorphologyEngine {
  private currentIntent: PhysicalIntent | null = null;

  /** life-loop 在 PHYSICAL_INTENT_DISPATCH 时注入当前意图 */
  public setIntent(intent: PhysicalIntent): void {
    this.currentIntent = intent;
  }

  /**
   * 把 (生命状态, 情绪, 当前意图) 翻译为渲染参数。
   */
  public render(state: LifeState, emotionalState: EmotionalState): RenderParams {
    const intentType: PhysicalIntentType = this.currentIntent?.type ?? "IDLE_BREATHE";
    const motion = INTENT_TO_MOTION[intentType] ?? "BREATH";

    // 眼开合比：能量越低越困；打盹/沉睡趋近闭合；高疲劳半阖
    let eyeOpenRatio = clamp01(0.25 + state.energy * 0.75);
    if (intentType === "DOZE") eyeOpenRatio = 0.08;
    if (state.pressures.fatiguePressure > 0.7) {
      eyeOpenRatio = Math.min(eyeOpenRatio, 0.55);
    }

    // 躯体缩放：好奇/唤醒越高越"精神"，微微放大
    const bodyScale = clamp01(
      1.0 + state.pressures.curiosityPressure * 0.12 + emotionalState.arousal * 0.05,
    );

    // 视线偏置：孤独时微微探身张望（PEEK 情绪外化），愉悦时上扬
    const gazeBias = {
      x: (state.pressures.lonelinessPressure - 0.5) * 4,
      y: (emotionalState.valence - 0.5) * 3,
    };

    return { motion, eyeOpenRatio, bodyScale, gazeBias };
  }
}
