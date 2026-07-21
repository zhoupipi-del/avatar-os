// ============================================================
// event-validator 单测基线 (R7 安全防护)
// 锁定"非法/越界事件必须被门禁拒绝"这一不变量。
// 用真实 KernelEvent 形状，不贴审计的虚构事件类型。
// ============================================================
import { describe, expect, test } from "vitest";
import { validateKernelEvent } from "../src/event-validator";
import { KernelEvent } from "../src/kernel-event";
import { makeKernelEvent } from "../src/kernel-event";

describe("validateKernelEvent — 运行时事件门禁", () => {
  test("合法事件通过校验", () => {
    const evt: KernelEvent = makeKernelEvent("SENSOR_CURSOR_MOVE", "SENSOR", { x: 0.5, y: -0.3 });
    expect(validateKernelEvent(evt)).toBe(true);
  });

  test("合法 PhysicalIntent 载荷(intensity/priority 在区间内)通过", () => {
    const evt = makeKernelEvent("PHYSICAL_INTENT_DISPATCH", "DRIVE", {
      type: "GREET",
      intensity: 0.9,
      priority: 80,
      source: "DRIVE",
      confidence: 1,
      timestamp: Date.now(),
    });
    expect(validateKernelEvent(evt)).toBe(true);
  });

  test("缺失 timestamp 被拒绝", () => {
    const evt = { type: "X", source: "SYSTEM", payload: null } as unknown;
    expect(validateKernelEvent(evt)).toBe(false);
  });

  test("非法 source 被拒绝", () => {
    const evt = { type: "X", source: "HACKER", timestamp: 123, payload: null } as unknown;
    expect(validateKernelEvent(evt)).toBe(false);
  });

  test("intensity 越界(>1)被拒绝", () => {
    const evt = makeKernelEvent("PHYSICAL_INTENT_DISPATCH", "AI", {
      type: "GREET",
      intensity: 1.5,
      priority: 50,
      source: "AI",
      confidence: 1,
      timestamp: Date.now(),
    });
    expect(validateKernelEvent(evt)).toBe(false);
  });

  test("priority 越界(>100)被拒绝", () => {
    const evt = makeKernelEvent("PHYSICAL_INTENT_DISPATCH", "AI", {
      type: "GREET",
      intensity: 0.5,
      priority: 250,
      source: "AI",
      confidence: 1,
      timestamp: Date.now(),
    });
    expect(validateKernelEvent(evt)).toBe(false);
  });

  test("gaze 越界(>1)被拒绝", () => {
    const evt = makeKernelEvent("GAZE_UPDATED", "SENSOR", { x: 2.0, y: 0.1 });
    expect(validateKernelEvent(evt)).toBe(false);
  });

  test("非对象输入被拒绝", () => {
    expect(validateKernelEvent(null)).toBe(false);
    expect(validateKernelEvent(42)).toBe(false);
    expect(validateKernelEvent("string")).toBe(false);
  });
});
