// ============================================================
// KernelEvent<T> — AvatarKernel 统一事件封装 (v0.1.0-alpha)
// ============================================================
// 所有经 AvatarKernel 流转的事件都包裹在此泛型壳内，
// 保证事件总带 type/source/timestamp 三元组，无需每个适配器重复。
//
// 与 kernelEventBus 的关系：
// - kernelEventBus(TypedEventBus) 是传输层（pub/sub，已落地）。
// - KernelEvent<T> 是事件语义层（带溯源元数据的包裹壳）。
// - AvatarKernel.dispatchKernelEvent() 负责将 KernelEvent 拆箱后路由到 Map<type, cb[]>。
// - 冻结期兼容：AvatarKernel 内部仍 emit 到 kernelEventBus，视图层暂不感知包裹层。
// ============================================================

import type { IntentSource } from "./intent";

export interface KernelEvent<T = unknown> {
  type: string;          // 事件类型 (e.g., "SENSOR_CURSOR_MOVE", "DRIVE_PRESSURE_TICK")
  source: IntentSource;  // 事件来源 (SENSOR / DRIVE / MEMORY / AI / SYSTEM)
  timestamp: number;     // epoch ms
  payload: T;            // 泛型载荷
}

/** makeKernelEvent — KernelEvent 工厂（封口溯源元数据） */
export function makeKernelEvent<T>(
  type: string,
  source: IntentSource,
  payload: T,
): KernelEvent<T> {
  return { type, source, timestamp: Date.now(), payload };
}
