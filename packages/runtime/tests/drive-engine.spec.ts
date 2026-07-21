// ============================================================
// DriveEngine 单测基线 (R5)
// 锁定"需求→压力"生理时钟的核心不变量：
//   - 离线 → 孤独压强单调累积
//   - 在场 → 孤独压强被压制
//   - PAD 情绪轴随能量/孤独正确演化
// 注意：本测试用【真实】API 签名，非审计给的错误签名。
// ============================================================
import { describe, expect, test } from "vitest";
import { DriveEngine } from "../src/drive-engine";
import { DEFAULT_PERSONALITY } from "../src/personality";
import { DEFAULT_PRESENCE, UserPresence } from "@avatar-os/sensor";

// 离线在场信号：level=0 即完全不在身边
const absentPresence: UserPresence = {
  ...DEFAULT_PRESENCE,
  level: 0,
  focusState: "AWAY",
  idleTimeMs: 3_600_000,
};

// 在场信号：level=1 即就在身边专注操作
const presentPresence: UserPresence = {
  ...DEFAULT_PRESENCE,
  level: 1,
  focusState: "FOCUSED",
  idleTimeMs: 0,
};

describe("DriveEngine — 需求→压力 生理时钟", () => {
  test("离线状态下孤独压强单调累积", () => {
    const engine = new DriveEngine({ energy: 1.0, socialNeed: 0.3 });
    let first = 0;
    let last = 0;
    for (let i = 0; i < 10; i++) {
      const { state } = engine.tick(1000, absentPresence, DEFAULT_PERSONALITY, 0.0);
      if (i === 0) first = state.pressures.lonelinessPressure;
      last = state.pressures.lonelinessPressure;
    }
    expect(last).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(first); // 单调增长
  });

  test("用户在场(level=1)时孤独压强被压制为 0", () => {
    const engine = new DriveEngine({ energy: 1.0, socialNeed: 0.3 });
    const { state } = engine.tick(1000, presentPresence, DEFAULT_PERSONALITY, 0.0);
    expect(state.pressures.lonelinessPressure).toBe(0);
  });

  test("PAD 情绪：能量高→valence 高；稳定性轴等于人格稳定性", () => {
    const engine = new DriveEngine({ energy: 1.0, socialNeed: 0.3 });
    const { emotionalState } = engine.tick(1000, presentPresence, DEFAULT_PERSONALITY, 0.0);
    expect(emotionalState.valence).toBeGreaterThan(0.5);
    expect(emotionalState.stability).toBe(DEFAULT_PERSONALITY.stability);
  });

  test("getState 返回独立副本(不暴露内部可变引用)", () => {
    const engine = new DriveEngine({ energy: 0.9 });
    const snap = engine.getState();
    snap.energy = 0.1; // 外部篡改不应影响内部
    expect(engine.getState().energy).toBe(0.9);
  });
});
