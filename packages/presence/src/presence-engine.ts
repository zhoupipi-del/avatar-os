import { kernelEventBus } from "@avatar-os/runtime";
import { makeIntent } from "@avatar-os/primitives";

/**
 * Phase 0.5 Presence Engine — 泊松式随机节律
 * 三条独立自主节律通道，各自随机区间递归调度：
 * - 眨眼 BLINK: 5-12s（纯 CSS 微动作，内核仅保持平静呼吸意图，不扰动 Mood）
 * - 伸懒腰 STRETCH: 30-180s
 * - 环顾巡视 LOOK_AT_USER: 60-300s
 * 只通过 kernelEventBus 发 PHYSICAL_INTENT_DISPATCH，绝不持有生命状态。
 */
export class PresenceEngine {
  private isRunning = false;

  public start() {
    this.isRunning = true;
    this.scheduleBlink();
    this.scheduleStretch();
    this.scheduleLookAround();
  }

  public stop() {
    this.isRunning = false;
  }

  private getRandomDelay(minSec: number, maxSec: number): number {
    return (Math.random() * (maxSec - minSec) + minSec) * 1000;
  }

  // 自主眨眼：5-12 秒泊松区间（眨眼为纯 CSS 微动作，内核发平静呼吸意图即可）
  private scheduleBlink() {
    if (!this.isRunning) return;
    setTimeout(() => {
      kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", makeIntent({ type: "IDLE_BREATHE", intensity: 0.3, source: "DRIVE" }));
      this.scheduleBlink();
    }, this.getRandomDelay(5, 12));
  }

  // 伸懒腰小动作：30-180 秒随机区间
  private scheduleStretch() {
    if (!this.isRunning) return;
    setTimeout(() => {
      kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", makeIntent({ type: "STRETCH", intensity: 0.8, source: "DRIVE" }));
      this.scheduleStretch();
    }, this.getRandomDelay(30, 180));
  }

  // 环顾巡视：60-300 秒随机区间
  private scheduleLookAround() {
    if (!this.isRunning) return;
    setTimeout(() => {
      kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", makeIntent({ type: "LOOK_AT_USER", intensity: 0.6, source: "DRIVE" }));
      this.scheduleLookAround();
    }, this.getRandomDelay(60, 300));
  }
}

export const presenceEngine = new PresenceEngine();
