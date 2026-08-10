/**
 * Day15A 演示模式运行时开关
 *
 * 仅控制「高级调试信息是否可见」，不改变任何音频 / 表情 / 嘴型行为。
 * 默认（无 ?debug、无齿轮切换）= 干净演示视图；DEV 下 ?debug 或齿轮按钮可揭示内部状态。
 */
import { useEffect, useState } from "react";

let advancedDebug = computeInitialAdvancedDebug();
const listeners = new Set<(value: boolean) => void>();

function computeInitialAdvancedDebug(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  if (typeof location !== "undefined") {
    return new URLSearchParams(location.search).has("debug");
  }
  return false;
}

export function isAdvancedDebug(): boolean {
  return advancedDebug;
}

export function setAdvancedDebug(value: boolean): void {
  if (advancedDebug === value) {
    return;
  }
  advancedDebug = value;
  listeners.forEach((listener) => listener(value));
}

export function subscribeAdvancedDebug(
  listener: (value: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAdvancedDebug(): boolean {
  const [value, setValue] = useState<boolean>(isAdvancedDebug());
  useEffect(() => subscribeAdvancedDebug(setValue), []);
  return value;
}
