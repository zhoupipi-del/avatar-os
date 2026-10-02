import { describe, expect, test, beforeEach } from "vitest";
import { DriveEngine } from "../src/drive-engine";
import { DEFAULT_PERSONALITY } from "../src/personality";
// UserPresence 仅作类型使用，import type 避免运行时拉起 sensor 包
import type { UserPresence } from "@avatar-os/sensor";

describe("DriveEngine Baseline Tests", () => {
  let driveEngine: DriveEngine;

  beforeEach(() => {
    driveEngine = new DriveEngine({ socialNeed: 0.3, energy: 1.0 });
  });

  test("loneliness pressure increases during idle time (user away)", () => {
    // 真实 UserPresence 形状（packages/sensor/src/presence-sensor.ts:21-30）
    const presenceMock: UserPresence = {
      level: 0.0,
      cursorEventsPerSec: 0,
      focusState: "AWAY",
      idleTimeMs: 600_000, // 10 分钟无交互
    };

    const { state } = driveEngine.tick(1000, presenceMock, DEFAULT_PERSONALITY, 0.0);
    expect(state.pressures.lonelinessPressure).toBeGreaterThan(0.0);
  });

  test("energy decays over time", () => {
    const presenceMock: UserPresence = {
      level: 1.0,
      cursorEventsPerSec: 0,
      focusState: "FOCUSED",
      idleTimeMs: 0,
    };
    const before = driveEngine.getState().energy;
    driveEngine.tick(3_600_000, presenceMock, DEFAULT_PERSONALITY, 0.0); // 1 小时
    const after = driveEngine.getState().energy;
    expect(after).toBeLessThan(before);
  });
});
