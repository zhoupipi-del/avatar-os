import { describe, expect, test } from "vitest";
import { SnapshotManager } from "../src/snapshot-manager";
import { driveEngine } from "../src/drive-engine";
import { avatarFSM } from "../src/avatar-fsm";
import type { UserPresence } from "@avatar-os/sensor";

// 真实 UserPresence 形状（packages/sensor/src/presence-sensor.ts:21-30）
const AWAY: UserPresence = {
  level: 0,
  cursorEventsPerSec: 0,
  focusState: "AWAY",
  idleTimeMs: 600_000,
};
const PERSONA = { openness: 0.7, extraversion: 0.6, stability: 0.8, attachment: 0.85 };

describe("SnapshotManager", () => {
  test("restore rolls back a mutated life state to the snapshot", () => {
    driveEngine.tick(1000, AWAY, PERSONA, 0);
    const snap = SnapshotManager.exportSnapshot();
    const energyBefore = snap.lifeState.energy;

    // 改变实时状态
    driveEngine.tick(3_600_000, { ...AWAY, level: 1 }, PERSONA, 0);
    expect(driveEngine.getState().energy).not.toBeCloseTo(energyBefore);

    // 恢复
    SnapshotManager.restoreSnapshot(snap);
    expect(driveEngine.getState().energy).toBeCloseTo(energyBefore);
    expect(avatarFSM.getMood().current).toBe(snap.mood.current);
  });

  test("restoreSnapshot rejects incompatible version", () => {
    const snap = SnapshotManager.exportSnapshot();
    expect(() => SnapshotManager.restoreSnapshot({ ...snap, version: "9.9.9" })).toThrow();
  });
});
