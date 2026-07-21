// ============================================================
// event-validator — 运行时事件门禁 (v0.1.0-alpha, R7 安全防护)
// ============================================================
// 所有经 AvatarKernel.dispatchKernelEvent 进入内核的事件都必须先过此关。
// 它阻断：
//   - 结构残缺（缺 type / timestamp / source）
//   - 非法来源（source 不在 IntentSource 白名单）
//   - 越界载荷（intensity ∉ [0,1]、priority ∉ [0,100]、gaze ∉ [-1,1]）
// 这是 LLM / 多模态等不可信外部输入挂载前的必要边界锁。
// ============================================================

import type { IntentSource } from "./intent";
import type { KernelEvent } from "./kernel-event";

const VALID_SOURCES: readonly IntentSource[] = ["DRIVE", "SENSOR", "MEMORY", "AI", "SYSTEM"];

/**
 * 校验一个未知对象是否为合法的 KernelEvent。
 * 返回类型谓词，便于在门禁处直接窄化类型。
 */
export function validateKernelEvent(event: unknown): event is KernelEvent<unknown> {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Record<string, unknown>;

  // 元数据基础检查
  if (typeof e.type !== "string" || e.type.length === 0) return false;
  if (typeof e.timestamp !== "number" || !Number.isFinite(e.timestamp) || e.timestamp <= 0) {
    return false;
  }
  if (typeof e.source !== "string" || !VALID_SOURCES.includes(e.source as IntentSource)) {
    return false;
  }

  // 物理边界锁：载荷内的数值区间校验
  const p = e.payload as Record<string, unknown> | null | undefined;
  if (p && typeof p === "object") {
    if ("intensity" in p) {
      const v = p.intensity;
      if (typeof v !== "number" || v < 0 || v > 1) return false;
    }
    if ("priority" in p) {
      const v = p.priority;
      if (typeof v !== "number" || v < 0 || v > 100) return false;
    }
    if ("x" in p || "y" in p) {
      const x = p.x as number;
      const y = p.y as number;
      if (typeof x === "number" && (x < -1 || x > 1)) return false;
      if (typeof y === "number" && (y < -1 || y > 1)) return false;
    }
  }

  return true;
}
