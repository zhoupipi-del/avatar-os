// ============================================================
// @avatar-os/sensor — 传感器适配器层 (v0.1.0-alpha)
// ============================================================
// 设计原则：
//   1. 传感器只负责"把物理世界输入翻译为 KernelEvent"，
//      绝不决定生命处于什么状态——状态路由全归 AvatarKernel。
//   2. 每个适配器的节流/去抖/阈值完全内聚，不改写内核逻辑。
//   3. 所有适配器经统一 callback → AvatarKernel.dispatchKernelEvent，
//      阻止 UI/组件/视图层裸监听 DOM 事件。
//
// 与冻结期 kernelEventBus 的关系：
//   本包只依赖 @avatar-os/primitives（KernelEvent 类型契约），
//   不依赖 @avatar-os/runtime（避免循环引用）。
//   向后兼容桥接（KernelEvent → kernelEventBus）由 AvatarKernel 内部完成。
// ============================================================

import type { KernelEvent } from "@avatar-os/primitives";

// ------- SensorAdapter 接口 -------

export interface SensorAdapter {
  /** 人类可读名称（用于日志与管理面板） */
  name: string;
  /** 启动传感器：传入回调=将 KernelEvent 送入内核管线 */
  start(cb: (event: KernelEvent) => void): void;
  /** 停止传感器：销毁监听器、清理计时器 */
  stop(): void;
}

// ------- MouseSensorAdapter (D2/P1: 光标近场输入) -------

export interface CursorMovePayload {
  x: number;
  y: number;
}

export class MouseSensorAdapter implements SensorAdapter {
  public readonly name = "MouseSensorAdapter";

  private readonly throttleMs: number;
  private readonly nearThreshold: number;
  private lastTime = 0;
  private isNear = false;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private container: HTMLElement | null = null;

  constructor(opts?: { throttleMs?: number; nearThreshold?: number }) {
    this.throttleMs = opts?.throttleMs ?? 50;
    this.nearThreshold = opts?.nearThreshold ?? 100;
  }

  /** 绑定到具体 DOM 容器（如 Tauri window 的 <main>） */
  public attach(container: HTMLElement): void {
    this.container = container;
  }

  public start(cb: (event: KernelEvent) => void): void {
    this.onMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - this.lastTime < this.throttleMs) return;
      this.lastTime = now;

      const rect = this.container?.getBoundingClientRect();
      if (!rect) return;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const x = e.clientX - cx;
      const y = e.clientY - cy;

      // 发射光标移动事件（每刻）
      cb({
        type: "SENSOR_CURSOR_MOVE",
        source: "SENSOR",
        timestamp: now,
        payload: { x, y } as CursorMovePayload,
      });

      // 近场/远场边界检测（仅在穿越阈值时发射一次）
      const distance = Math.hypot(x, y);
      const near = distance < this.nearThreshold;
      if (near !== this.isNear) {
        this.isNear = near;
        const evtType = near ? "SENSOR_CURSOR_NEAR" : "SENSOR_CURSOR_FAR";
        cb({
          type: evtType,
          source: "SENSOR",
          timestamp: now,
          payload: near ? { distance } : null,
        });
      }
    };

    window.addEventListener("mousemove", this.onMouseMove);
  }

  public stop(): void {
    if (this.onMouseMove) {
      window.removeEventListener("mousemove", this.onMouseMove);
      this.onMouseMove = null;
    }
  }
}

// ------- IdleSensorAdapter (D2/P1: 用户空闲探测) -------

export interface IdleCheckPayload {
  idleMinutes: number;
}

export class IdleSensorAdapter implements SensorAdapter {
  public readonly name = "IdleSensorAdapter";

  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastActivityAt: number = Date.now();

  constructor(opts?: { intervalMs?: number }) {
    this.intervalMs = opts?.intervalMs ?? 60_000;
  }

  public start(cb: (event: KernelEvent) => void): void {
    // 追踪最后一次用户活动
    const trackActivity = () => {
      this.lastActivityAt = Date.now();
    };
    window.addEventListener("mousemove", trackActivity, { passive: true });
    window.addEventListener("keydown", trackActivity, { passive: true });
    window.addEventListener("click", trackActivity, { passive: true });

    this.timer = setInterval(() => {
      const idleMs = Date.now() - this.lastActivityAt;
      const idleMinutes = Math.floor(idleMs / 60_000);
      cb({
        type: "SENSOR_IDLE_CHECK",
        source: "SENSOR",
        timestamp: Date.now(),
        payload: { idleMinutes } as IdleCheckPayload,
      });
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ------- 在场感知层 (v0.1.0-alpha Life Closed-Loop) -------
export * from "./presence-sensor";

// ------- 默认传感器注册表 -------

/**
 * createDefaultSensors — 一键创建 Day1-7 常用传感器组。
 * 未来扩展（Day8+ Webcam / Day15+ Audio / Day21+ Mic）只需在此追加。
 */
export function createDefaultSensors(
  mouseOpts?: { throttleMs?: number; nearThreshold?: number },
  idleOpts?: { intervalMs?: number },
): SensorAdapter[] {
  return [
    new MouseSensorAdapter(mouseOpts),
    new IdleSensorAdapter(idleOpts),
  ];
}
