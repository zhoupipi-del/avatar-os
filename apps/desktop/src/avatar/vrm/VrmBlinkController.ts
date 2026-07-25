/**
 * VRM 眨眼控制器 — 用 VRM expressionManager 的 "blink" BlendShape
 *
 * AvatarSample_Z.vrm 有完整 blink 表情，不需要伪造眼皮骨骼。
 * 程序化随机眨眼：间隔 2.2~6.0s, 持续 0.16s, 三角波插值。
 */

import type { VRM } from "@pixiv/three-vrm";

export class VrmBlinkController {
  private elapsed = 0;
  /** 下次眨眼触发时间（从上次 blink 结束算起） */
  private nextBlinkAt = 2.5;
  /** 当前 blink 进行时间（<0 表示不在眨眼） */
  private blinkElapsed = -1;

  /**
   * 每帧调用。驱动程序化眨眼。
   *
   * @param vrm - 目标 VRM 实例
   * @param delta - 帧间隔（秒）
   */
  public update(vrm: VRM, delta: number): void {
    const expressions = vrm.expressionManager;

    if (!expressions) return;

    this.elapsed += delta;

    // 触发新一次眨眼
    if (this.blinkElapsed < 0 && this.elapsed >= this.nextBlinkAt) {
      this.blinkElapsed = 0;
      this.elapsed = 0;
      // 随机间隔 2.2 ~ 6.0 秒
      this.nextBlinkAt = 2.2 + Math.random() * 3.8;
    }

    // 不在眨眼周期内
    if (this.blinkElapsed < 0) {
      return;
    }

    this.blinkElapsed += delta;

    const duration = 0.16; // 眨眼总时长（秒）
    const progress = this.blinkElapsed / duration;

    // 三角波：0→1→0
    const value =
      progress < 0.5 ? progress * 2 : (1 - progress) * 2;

    expressions.setValue("blink", Math.max(0, Math.min(1, value)));

    // 眨眼结束，重置
    if (progress >= 1) {
      expressions.setValue("blink", 0);
      this.blinkElapsed = -1;
    }
  }
}
