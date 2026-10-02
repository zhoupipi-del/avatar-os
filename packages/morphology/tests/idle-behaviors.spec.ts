import { describe, it, expect } from "vitest";
import {
  IDLE_BEHAVIORS,
  ALL_IDLE_BEHAVIORS,
  nextIdleDelay,
  pickIdleBehavior,
  idlePoseAt,
  type IdleBehaviorType,
} from "../src/index";
import { composeLimbAngles, REST_LIMB_ANGLES } from "../src/index";

describe("随机行为树 — 调度器", () => {
  it("nextIdleDelay 恒在 [10000, 30000) 内", () => {
    const rng = () => 0.5;
    for (let i = 0; i < 50; i++) {
      const d = nextIdleDelay(Math.random);
      expect(d).toBeGreaterThanOrEqual(10_000);
      expect(d).toBeLessThan(30_000);
    }
    expect(nextIdleDelay(() => 0)).toBe(10_000);
    expect(nextIdleDelay(() => 0.999)).toBeLessThan(30_000);
    expect(nextIdleDelay(rng)).toBe(20_000);
  });

  it("ALL_IDLE_BEHAVIORS 共 8 种且覆盖全部类型", () => {
    expect(ALL_IDLE_BEHAVIORS).toHaveLength(8);
    const expected: IdleBehaviorType[] = [
      "LOOK_AROUND",
      "SCRATCH_HEAD",
      "YAWN",
      "STRETCH",
      "HAPPY_BOUNCE",
      "SLEEPY_SWAY",
      "HEAD_TILT",
      "WIGGLE",
    ];
    expect(ALL_IDLE_BEHAVIORS).toEqual(expected);
  });

  it("pickIdleBehavior 边界：rng=0→首项, rng→1→末项, rng=0.5→中段", () => {
    expect(pickIdleBehavior(() => 0)).toBe("LOOK_AROUND");
    expect(pickIdleBehavior(() => 0.999)).toBe("WIGGLE");
    expect(pickIdleBehavior(() => 0.5)).toBe("HAPPY_BOUNCE");
  });

  it("每个行为定义完整：duration>0 + 想法 emoji/文本非空", () => {
    for (const def of Object.values(IDLE_BEHAVIORS)) {
      expect(def.durationMs).toBeGreaterThan(0);
      expect(def.thought.emoji.length).toBeGreaterThan(0);
      expect(def.thought.text.length).toBeGreaterThan(0);
    }
  });
});

describe("随机行为树 — 各动作姿态特征", () => {
  it("LOOK_AROUND：头部左右摆(进度 0.25 右倾, 0.75 左倾)", () => {
    const def = IDLE_BEHAVIORS.LOOK_AROUND;
    const r25 = idlePoseAt(def, def.durationMs * 0.25, 0);
    const r75 = idlePoseAt(def, def.durationMs * 0.75, 0);
    expect(r25.tilt).toBeGreaterThan(0);
    expect(r75.tilt).toBeLessThan(0);
    expect(r25.angles).toEqual(REST_LIMB_ANGLES); // 手臂静息
  });

  it("SCRATCH_HEAD：仅左臂抬到头侧(<-100)", () => {
    const def = IDLE_BEHAVIORS.SCRATCH_HEAD;
    const r = idlePoseAt(def, 0, 0);
    expect(r.angles.armL).toBeLessThan(-100);
    expect(r.angles.armR).toBe(0);
  });

  it("YAWN：双臂随包络上抬，中段抬得最高", () => {
    const def = IDLE_BEHAVIORS.YAWN;
    const mid = idlePoseAt(def, def.durationMs * 0.5, 0);
    const start = idlePoseAt(def, 0, 0);
    expect(Math.abs(mid.angles.armL)).toBeGreaterThan(Math.abs(start.angles.armL));
    expect(mid.bob).toBeLessThan(0); // 身体微沉
  });

  it("STRETCH：双臂高高舒展(|角|>100, 左右符号相反)", () => {
    const def = IDLE_BEHAVIORS.STRETCH;
    const r = idlePoseAt(def, 0, 0);
    expect(r.angles.armL).toBeLessThan(-100);
    expect(r.angles.armR).toBeGreaterThan(100);
  });

  it("HAPPY_BOUNCE：双臂欢呼 + 整体上下蹦(bob>0)", () => {
    const def = IDLE_BEHAVIORS.HAPPY_BOUNCE;
    const r = idlePoseAt(def, def.durationMs * 0.25, 0);
    expect(r.angles.armL).toBeLessThan(-100);
    expect(r.angles.armR).toBeGreaterThan(100);
    expect(r.bob).toBeGreaterThan(0);
  });

  it("SLEEPY_SWAY：身体缓慢单边摇摆 + 微沉", () => {
    const def = IDLE_BEHAVIORS.SLEEPY_SWAY;
    const r = idlePoseAt(def, def.durationMs * 0.5, 0);
    expect(r.tilt).toBeGreaterThan(0); // 包络中段摆到一侧
    expect(r.bob).toBe(2);
    expect(r.angles.armL).toBeGreaterThan(0); // 手臂略耷拉
  });

  it("HEAD_TILT：头部向一侧轻歪再回正(中段≈-14)", () => {
    const def = IDLE_BEHAVIORS.HEAD_TILT;
    const r = idlePoseAt(def, def.durationMs * 0.5, 0);
    expect(r.tilt).toBeCloseTo(-14, 5);
  });

  it("WIGGLE：快速左右扭 + 双臂反向小摆", () => {
    const def = IDLE_BEHAVIORS.WIGGLE;
    const r = idlePoseAt(def, def.durationMs * 0.5, 0);
    expect(Math.abs(r.tilt)).toBeGreaterThan(0);
    expect(Math.sign(r.angles.armL)).toBe(-Math.sign(r.angles.armR));
  });

  it("idlePoseAt 进度越界被钳制(不爆值)", () => {
    const def = IDLE_BEHAVIORS.STRETCH;
    const over = idlePoseAt(def, def.durationMs * 5, 0); // 远超 duration
    expect(Number.isFinite(over.angles.armL)).toBe(true);
    expect(Number.isFinite(over.tilt)).toBe(true);
  });
});

describe("composeLimbAngles — idle 底层", () => {
  it("idle 作为最底层，被 reach 叠加(5+10=15)", () => {
    const c = composeLimbAngles({
      idle: { armL: 5, armR: 5, legL: 0, legR: 0 },
      reach: { armL: 10, armR: -10, legL: 0, legR: 0 },
    });
    expect(c.armL).toBe(15);
    expect(c.armR).toBe(-5);
  });

  it("无交互层时仅 idle 生效", () => {
    const c = composeLimbAngles({
      idle: { armL: 7, armR: -7, legL: 3, legR: -3 },
    });
    expect(c.armL).toBe(7);
    expect(c.legR).toBe(-3);
  });

  it("status 仍最高优先级(覆盖 idle+reach)", () => {
    const c = composeLimbAngles({
      idle: { armL: 5, armR: 5, legL: 0, legR: 0 },
      reach: { armL: 10, armR: -10, legL: 0, legR: 0 },
      status: { armL: -155, armR: 155, legL: 0, legR: 0 },
    });
    expect(c.armL).toBe(-155);
    expect(c.armR).toBe(155);
  });
});
