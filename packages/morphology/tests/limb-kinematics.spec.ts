import { describe, it, expect } from "vitest";
import {
  computeArmReachAngle,
  clientToSvg,
  SHOULDER_L,
  SHOULDER_R,
  typingIntensityFromRate,
  typingPose,
  scratchHeadPose,
  stepSpring,
  dragAccelFromDelta,
  ZERO_SPRING,
  systemStatusToLimbs,
  composeLimbAngles,
  REST_LIMB_ANGLES,
} from "../src/index";

describe("F1 computeArmReachAngle (鼠标引力 IK)", () => {
  it("光标在正下方 → 小角度(手朝下)", () => {
    const a = computeArmReachAngle(SHOULDER_L, { x: 22, y: 140 }, { side: "L" });
    expect(a).toBeGreaterThan(-20);
    expect(a).toBeLessThan(20);
  });
  it("光标在左侧 → 负(外撇)角", () => {
    const a = computeArmReachAngle(SHOULDER_L, { x: 0, y: 90 }, { side: "L" });
    expect(a).toBeLessThan(0);
  });
  it("光标在右侧 → 正角", () => {
    const a = computeArmReachAngle(SHOULDER_L, { x: 100, y: 90 }, { side: "L" });
    expect(a).toBeGreaterThan(0);
  });
  it("钳制在 maxReach 内", () => {
    const a = computeArmReachAngle(SHOULDER_L, { x: 22, y: -200 }, { side: "L", maxReach: 75 });
    expect(a).toBeLessThanOrEqual(75);
    expect(a).toBeGreaterThanOrEqual(-75);
  });
  it("光标在两肩中间正下方 → 双臂内收符号相反(镜像)", () => {
    const al = computeArmReachAngle(SHOULDER_L, { x: 60, y: 120 }, { side: "L" });
    const ar = computeArmReachAngle(SHOULDER_R, { x: 60, y: 120 }, { side: "R" });
    expect(Math.sign(ar)).toBe(-Math.sign(al));
  });
});

describe("clientToSvg", () => {
  it("左上角 → (0,0)", () => {
    const p = clientToSvg(10, 20, { left: 10, top: 20, width: 120, height: 155 });
    expect(p).toEqual({ x: 0, y: 0 });
  });
  it("右下角 → (120,155)", () => {
    const p = clientToSvg(130, 175, { left: 10, top: 20, width: 120, height: 155 });
    expect(p).toEqual({ x: 120, y: 155 });
  });
});

describe("F2 键盘打字", () => {
  it("0 键/s → 强度 0", () => {
    expect(typingIntensityFromRate(0)).toBe(0);
  });
  it("20+ 键/s → 强度封顶 1", () => {
    expect(typingIntensityFromRate(40)).toBe(1);
  });
  it("静止姿态 = 静息", () => {
    expect(typingPose(0, 0)).toEqual(REST_LIMB_ANGLES);
  });
  it("打字时双臂对称抬起(符号相反)", () => {
    const p = typingPose(1, 0);
    expect(p.armL).toBeLessThan(0);
    expect(p.armR).toBeGreaterThan(0);
    expect(Math.abs(p.armL)).toBeCloseTo(Math.abs(p.armR), 5);
  });
  it("挠头只抬左臂", () => {
    const p = scratchHeadPose(0);
    expect(p.armL).toBeLessThan(-100);
    expect(p.armR).toBe(0);
  });
});

describe("F3 布娃娃弹簧", () => {
  it("静息弹簧保持 0", () => {
    const s = stepSpring(ZERO_SPRING, 0, 0.12);
    expect(s.angle).toBe(0);
  });
  it("受加速度后离开 0, 松手后回归 ~0", () => {
    let s = ZERO_SPRING;
    for (let i = 0; i < 5; i++) s = stepSpring(s, 30, 0.05);
    expect(s.angle).not.toBe(0);
    for (let i = 0; i < 400; i++) s = stepSpring(s, 0, 0.05);
    expect(Math.abs(s.angle)).toBeLessThan(0.5);
  });
  it("角度钳制在 [-60,60]", () => {
    let s = ZERO_SPRING;
    for (let i = 0; i < 50; i++) s = stepSpring(s, 1000, 0.05);
    expect(s.angle).toBeLessThanOrEqual(60);
    expect(s.angle).toBeGreaterThanOrEqual(-60);
  });
  it("dragAccelFromDelta 随 jerk 缩放", () => {
    const a = dragAccelFromDelta(0, 100, 0.1);
    expect(a).toBeGreaterThan(0);
  });
});

describe("F4 系统状态映射", () => {
  it("idle → 静息", () => {
    expect(systemStatusToLimbs("idle", 0)).toEqual(REST_LIMB_ANGLES);
  });
  it("success → 双臂举过头顶", () => {
    const p = systemStatusToLimbs("success", 0);
    expect(p.armL).toBeLessThan(-100);
    expect(p.armR).toBeGreaterThan(100);
  });
  it("error → 双臂抱头", () => {
    const p = systemStatusToLimbs("error", 0);
    expect(Math.abs(p.armL)).toBeGreaterThan(100);
    expect(Math.abs(p.armR)).toBeGreaterThan(100);
  });
});

describe("composeLimbAngles", () => {
  it("reach + typing 叠加", () => {
    const c = composeLimbAngles({
      reach: { armL: 10, armR: -10, legL: 0, legR: 0 },
      typing: { armL: -20, armR: 20, legL: 0, legR: 0 },
    });
    expect(c.armL).toBe(-10);
    expect(c.armR).toBe(10);
  });
  it("status 覆盖双臂", () => {
    const c = composeLimbAngles({
      reach: { armL: 10, armR: -10, legL: 0, legR: 0 },
      status: { armL: -155, armR: 155, legL: 0, legR: 0 },
    });
    expect(c.armL).toBe(-155);
    expect(c.armR).toBe(155);
  });
  it("最终角度钳制", () => {
    const c = composeLimbAngles({
      typing: { armL: 200, armR: -200, legL: 0, legR: 0 },
    });
    expect(c.armL).toBeLessThanOrEqual(175);
    expect(c.armR).toBeGreaterThanOrEqual(-175);
  });
});
