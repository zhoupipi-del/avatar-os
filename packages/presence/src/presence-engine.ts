// ============================================================
// @avatar-os/presence — PresenceEngine (v0.1.0-alpha)
// ============================================================
// 重构（R2 竞态修复）：彻底移除内部 setInterval/setTimeout 定时器，
// 降级为「纯函数节律步进器」，完全由 LifeLoop 的单一 1000ms 心跳统一驱动。
//
// 设计要点：
//   - 不再持有任何并发定时器；step() 由 LifeLoop 每 tick 调用一次。
//   - 微动作（眨眼/伸懒腰/环顾）是纯 CSS 表现层动作，不进入 Mood 路由，
//     因此由 LifeLoop 经 kernelEventBus 直接下发，与 BehaviorVM 的
//     "有意义行为"（GREET/PEEK/DOZE）仲裁互不干扰、但共用同一心跳。
//   - 旧版 presenceEngine.start() 的 3 条递归 setTimeout 已删除，
//     从根上消灭"双心跳竞争"。
// ============================================================

import { makeIntent, PhysicalIntentType } from "@avatar-os/primitives";

export class PresenceEngine {
  private lastBlinkMs = 0;
  private lastGazeMs = 0;
  private lastStretchMs = 0;

  /**
   * 由 LifeLoop 单心跳统一调用。
   * @returns 本 tick 触发的微动作意图类型；无则返回 undefined
   */
  public step(nowMs: number, idleMs: number): PhysicalIntentType | undefined {
    const sinceBlink = nowMs - this.lastBlinkMs;
    const sinceGaze = nowMs - this.lastGazeMs;
    const sinceStretch = nowMs - this.lastStretchMs;

    // 泊松节律近似（概率触发，与旧版区间一致）
    if (sinceBlink > 3000 && Math.random() < 0.3) {
      this.lastBlinkMs = nowMs;
      return "IDLE_BREATHE"; // 眨眼 = 平静呼吸微动作
    }
    if (idleMs < 5000 && sinceGaze > 8000 && Math.random() < 0.2) {
      this.lastGazeMs = nowMs;
      return "LOOK_AT_USER"; // 活跃时偶尔环顾
    }
    if (idleMs > 60000 && sinceStretch > 120000 && Math.random() < 0.1) {
      this.lastStretchMs = nowMs;
      return "STRETCH"; // 长时间空闲后伸懒腰
    }
    return undefined;
  }
}

export const presenceEngine = new PresenceEngine();
