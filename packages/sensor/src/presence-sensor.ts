// ============================================================
// @avatar-os/sensor — PresenceSensorLayer (v0.1.0-alpha)
// ============================================================
// 蓝图"在场感知层"：把零散的物理输入（光标近场频率、键盘/点击活动、
// 空闲时长）聚合成单一可消费的 UserPresence 信号。
//
// 设计原则（沿用 SensorAdapter 契约）：
//   - 只翻译物理世界 → UserPresence，绝不决定生命状态（状态路由全归内核）。
//   - 通过 start(cb) 仍向内核桥接 SENSOR_CURSOR_NEAR/FAR/IDLE_CHECK，
//     兼容遗留 AvatarFSM 的近场好奇路由。
//   - 真正的在场快照由 getPresence() 提供，供 life-loop 每 tick 采样，
//     这是把"真实世界信号"喂给 DriveEngine 的唯一入口（O1 修复）。
// ============================================================

import { clamp01 } from "@avatar-os/primitives";
import type { KernelEvent } from "@avatar-os/primitives";
import type { SensorAdapter } from "./index";

export type FocusState = "FOCUSED" | "IDLE" | "AWAY";

export interface UserPresence {
  /** 用户在场强度 0.0(完全不在) ~ 1.0(就在身边) */
  level: number;
  /** 近场光标事件率（事件/秒），反映"正在专注操作" */
  cursorEventsPerSec: number;
  /** 焦点状态：专注 / 空闲 / 离开 */
  focusState: FocusState;
  /** 距上次活动的毫秒数 */
  idleTimeMs: number;
}

export const DEFAULT_PRESENCE: UserPresence = {
  level: 0,
  cursorEventsPerSec: 0,
  focusState: "AWAY",
  idleTimeMs: 0,
};

export class PresenceSensorLayer implements SensorAdapter {
  public readonly name = "PresenceSensorLayer";

  private readonly nearThreshold: number;
  private level = 0;
  private lastActivityAt = Date.now();
  private lastSampleAt = Date.now();
  private isNear = false;
  private cursorEventTimes: number[] = [];
  private container: HTMLElement | null = null;
  private onMove: ((e: MouseEvent) => void) | null = null;
  private onActivity: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: { nearThreshold?: number }) {
    this.nearThreshold = opts?.nearThreshold ?? 120;
  }

  /** 绑定到具体 DOM 容器（如 Tauri window 的 <main>）以计算近场距离 */
  public attach(container: HTMLElement): void {
    this.container = container;
  }

  public start(cb: (event: KernelEvent) => void): void {
    this.onMove = (e: MouseEvent) => {
      const now = Date.now();
      this.lastActivityAt = now;
      this.cursorEventTimes.push(now);

      const rect = this.container?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const distance = Math.hypot(e.clientX - cx, e.clientY - cy);

      const near = distance < this.nearThreshold;
      if (near) this.level = 1.0; // 近场即满强度
      if (near !== this.isNear) {
        this.isNear = near;
        const evtType = near ? "SENSOR_CURSOR_NEAR" : "SENSOR_CURSOR_FAR";
        cb({
          type: evtType,
          source: "SENSOR",
          timestamp: now,
          payload: near ? { distance } : null,
        } as KernelEvent);
      }
    };
    window.addEventListener("mousemove", this.onMove);

    this.onActivity = () => {
      this.lastActivityAt = Date.now();
    };
    window.addEventListener("keydown", this.onActivity, { passive: true });
    window.addEventListener("click", this.onActivity, { passive: true });

    this.idleTimer = setInterval(() => {
      const idleMs = Date.now() - this.lastActivityAt;
      cb({
        type: "SENSOR_IDLE_CHECK",
        source: "SENSOR",
        timestamp: Date.now(),
        payload: { idleMinutes: Math.floor(idleMs / 60_000) },
      } as KernelEvent);
    }, 60_000);
  }

  public stop(): void {
    if (this.onMove) window.removeEventListener("mousemove", this.onMove);
    if (this.onActivity) {
      window.removeEventListener("keydown", this.onActivity);
      window.removeEventListener("click", this.onActivity);
    }
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.onMove = null;
    this.onActivity = null;
    this.idleTimer = null;
  }

  /**
   * 当前在场信号快照（life-loop 每 tick 采样）。
   * level 随时间自然衰减，无近场活动时趋向 0；用户离开 30min → level≈0。
   */
  public getPresence(): UserPresence {
    const now = Date.now();
    const dt = Math.max(1, now - this.lastSampleAt) / 1000;
    this.lastSampleAt = now;

    // 无近场活动 → 在场强度衰减（约 4s 内从 1.0 落到 0）
    this.level = clamp01(this.level - 0.25 * dt);

    // 统计最近 1s 窗口内的光标事件数 → 事件/秒
    const cutoff = now - 1000;
    this.cursorEventTimes = this.cursorEventTimes.filter((t) => t >= cutoff);
    const cursorEventsPerSec = this.cursorEventTimes.length;

    const idleTimeMs = now - this.lastActivityAt;
    let focusState: FocusState = "AWAY";
    if (idleTimeMs < 3000) focusState = "FOCUSED";
    else if (idleTimeMs < 60_000) focusState = "IDLE";

    return {
      level: this.level,
      cursorEventsPerSec,
      focusState,
      idleTimeMs,
    };
  }
}
