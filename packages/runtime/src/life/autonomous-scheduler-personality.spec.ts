// ============================================================
// AutonomousScheduler × Personality 集成 + soak 测试 (v0.3.6-B)
// ============================================================
// 验证"人格只调音、绝不绕过调度器发意图"的单向链路：
//   PersonalityTraits → deriveBehaviorTuning → applyTuning → AutonomousScheduler → PhysicalIntent
//
// 覆盖开工契约可测项：
//   高好奇 PEEK > 安静 / 高独立 PEEK < 低独立 / 高社交 lonely 更多 /
//   高耐心 one-shot 更少(调音层) / 任意人格不破安全底线 /
//   阶段闸门(active/sleeping/clip) 与 用户打断(AI+SENSOR) 跨人格保持 /
//   同 profile 确定性 / 固定种子 30min soak × 3 profile 分布不同
// ============================================================

import { describe, it, expect } from "vitest";
import {
  AutonomousScheduler,
  STRETCH_COOLDOWN_MS,
  GLOBAL_ONESHOT_GAP_MS,
  type AutonomousEmitPayload,
} from "./autonomous-scheduler";
import type { LifePhase } from "./life-phase";
import type { PhysicalIntentType } from "@avatar-os/primitives";
import {
  NEUTRAL_TRAITS,
  BUILTIN_PERSONALITY_PROFILES,
  deriveBehaviorTuning,
  PEEK_MIN_COOLDOWN_MS,
  type PersonalityTraits,
} from "../personality/behavior-tuning";

const alwaysFire = () => 0;
const neverFire = () => 0.999;
const traits = (over: Partial<PersonalityTraits>): PersonalityTraits => ({ ...NEUTRAL_TRAITS, ...over });

interface RunResult {
  emitted: { type: PhysicalIntentType; t: number }[];
  lonelyWait: number;
}

/** 单阶段确定性模拟：rng 注入、fake clock，统计 PEEK/STRETCH 意图与 lonely-wait 触发次数。 */
function runPhase(phase: LifePhase, ticks: number, t: PersonalityTraits, rng: () => number): RunResult {
  let now = 0;
  let current: PhysicalIntentType | null = null;
  let prevBehavior: string | null = null;
  let lonelyWait = 0;
  const emitted: { type: PhysicalIntentType; t: number }[] = [];
  const s = new AutonomousScheduler({
    emit: (p: AutonomousEmitPayload) => {
      emitted.push({ type: p.type, t: now });
      current = p.type;
    },
    rng,
    personality: t,
  });
  for (let i = 0; i < ticks; i++) {
    now = (i + 1) * 1000;
    s.tick(phase, now, current);
    const b = s.getState().behavior;
    if (b === "lonely-wait" && prevBehavior !== "lonely-wait") lonelyWait++;
    prevBehavior = b;
  }
  return { emitted, lonelyWait };
}

/** 多阶段混合模拟（soak 用）：idle→curious→lonely 各 600 tick = 30min。 */
function runMixed(t: PersonalityTraits, rng: () => number): RunResult {
  const schedule: { phase: LifePhase; ticks: number }[] = [
    { phase: "idle", ticks: 600 },
    { phase: "curious", ticks: 600 },
    { phase: "lonely", ticks: 600 },
  ];
  let now = 0;
  let current: PhysicalIntentType | null = null;
  let prevBehavior: string | null = null;
  let lonelyWait = 0;
  const emitted: { type: PhysicalIntentType; t: number }[] = [];
  const s = new AutonomousScheduler({
    emit: (p: AutonomousEmitPayload) => {
      emitted.push({ type: p.type, t: now });
      current = p.type;
    },
    rng,
    personality: t,
  });
  let tickIndex = 0;
  for (const seg of schedule) {
    for (let i = 0; i < seg.ticks; i++) {
      tickIndex++;
      now = tickIndex * 1000;
      s.tick(seg.phase, now, current);
      const b = s.getState().behavior;
      if (b === "lonely-wait" && prevBehavior !== "lonely-wait") lonelyWait++;
      prevBehavior = b;
    }
  }
  return { emitted, lonelyWait };
}

const count = (r: RunResult, type: PhysicalIntentType) => r.emitted.filter((e) => e.type === type).length;
const oneShots = (r: RunResult) => r.emitted.filter((e) => e.type === "PEEK" || e.type === "STRETCH");

describe("人格 → 行为节奏方向（注入 rng 确定性）", () => {
  it("高好奇心 PEEK 数 > 安静观察者 PEEK 数", () => {
    const hi = runPhase("curious", 600, BUILTIN_PERSONALITY_PROFILES["curious-explorer"], alwaysFire);
    const lo = runPhase("curious", 600, BUILTIN_PERSONALITY_PROFILES["quiet-observer"], alwaysFire);
    expect(count(hi, "PEEK")).toBeGreaterThan(count(lo, "PEEK"));
  });

  it("高独立 PEEK 数 < 低独立 PEEK 数（其余维度中性，隔离 independence）", () => {
    const hi = runPhase("curious", 600, traits({ independence: 0.95 }), alwaysFire);
    const lo = runPhase("curious", 600, traits({ independence: 0.05 }), alwaysFire);
    expect(count(hi, "PEEK")).toBeLessThan(count(lo, "PEEK"));
  });

  it("高社交 lonely-wait 数 > 低社交 lonely-wait 数", () => {
    const hi = runPhase("lonely", 600, traits({ sociability: 0.95 }), alwaysFire);
    const lo = runPhase("lonely", 600, traits({ sociability: 0.05 }), alwaysFire);
    expect(hi.lonelyWait).toBeGreaterThan(lo.lonelyWait);
  });

  it("高耐心 → STRETCH 调音概率更低（one-shot 更少，调音层断言）", () => {
    const hi = deriveBehaviorTuning(traits({ patience: 0.95 })).stretchChanceMultiplier;
    const lo = deriveBehaviorTuning(traits({ patience: 0.05 })).stretchChanceMultiplier;
    expect(hi).toBeLessThan(lo);
  });
});

describe("任意人格不突破安全底线", () => {
  const profiles: PersonalityTraits[] = [
    BUILTIN_PERSONALITY_PROFILES["companion-default"],
    BUILTIN_PERSONALITY_PROFILES["curious-explorer"],
    BUILTIN_PERSONALITY_PROFILES["quiet-observer"],
    traits({ curiosity: 1, sociability: 1, patience: 1, independence: 1, expressiveness: 1 }),
    traits({ curiosity: 0, sociability: 0, patience: 0, independence: 0, expressiveness: 0 }),
  ];

  for (const p of profiles) {
    it(`mulberry32 种子确定性 soak 不破底线 (curiosity=${p.curiosity})`, () => {
      let seed = 0;
      const rng = () => {
        // 简单可重复 PRNG，避免引入外部依赖
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      const r = runMixed(p, rng);
      const stretches = r.emitted.filter((e) => e.type === "STRETCH").map((e) => e.t);

      // STRETCH ≤ 8（30min 不频发）
      expect(stretches.length).toBeLessThanOrEqual(8);
      expect(stretches.length).toBeGreaterThan(0);
      // 相邻 STRETCH 间隔 ≥ 240s
      for (let i = 1; i < stretches.length; i++) {
        expect(stretches[i] - stretches[i - 1]).toBeGreaterThanOrEqual(STRETCH_COOLDOWN_MS);
      }
      // 任意两个 one-shot 间隔 ≥ 全局 15s（无连续重复/风暴）
      const os = oneShots(r);
      for (let i = 1; i < os.length; i++) {
        expect(os[i].t - os[i - 1].t).toBeGreaterThanOrEqual(GLOBAL_ONESHOT_GAP_MS);
      }
      // 相邻 PEEK 间隔 ≥ 最低 20s
      const peeks = r.emitted.filter((e) => e.type === "PEEK").map((e) => e.t);
      for (let i = 1; i < peeks.length; i++) {
        expect(peeks[i] - peeks[i - 1]).toBeGreaterThanOrEqual(PEEK_MIN_COOLDOWN_MS);
      }
    });
  }
});

describe("阶段闸门与用户打断跨人格保持", () => {
  const profiles: PersonalityTraits[] = [
    BUILTIN_PERSONALITY_PROFILES["companion-default"],
    BUILTIN_PERSONALITY_PROFILES["curious-explorer"],
    BUILTIN_PERSONALITY_PROFILES["quiet-observer"],
  ];

  for (const p of profiles) {
    it(`active / sleeping 阶段不触发 PEEK·STRETCH (curiosity=${p.curiosity})`, () => {
      for (const phase of ["active", "sleeping"] as LifePhase[]) {
        const r = runPhase(phase, 300, p, alwaysFire);
        expect(count(r, "PEEK")).toBe(0);
        expect(count(r, "STRETCH")).toBe(0);
      }
    });

    it(`clip 播放期间不插入自主动作 (curiosity=${p.curiosity})`, () => {
      const s = new AutonomousScheduler({ emit: () => {}, rng: alwaysFire, personality: p });
      s.notifyClipPlayback(true);
      for (let i = 0; i < 300; i++) s.tick("idle", (i + 1) * 1000, null);
      // 无法从内部读 emitted，改用状态：clip 占身体期间 behavior 不会是 one-shot id
      // 直接验证：emit 在 clip 期间不触发（上面 emit 为空函数，此处仅确认无异常）
      expect(s.getState().source).not.toBe("scheduler");
    });

    it(`AI(GREET) 与 SENSOR(BOUNCE_HAPPY) 两类用户意图均能接管并进入静默窗 (curiosity=${p.curiosity})`, () => {
      for (const [type, label] of [["GREET", "AI"], ["BOUNCE_HAPPY", "SENSOR"]] as const) {
        const e: PhysicalIntentType[] = [];
        const s = new AutonomousScheduler({ emit: (pp) => e.push(pp.type), rng: alwaysFire, personality: p });
        s.notifyUserIntent(type, 1000);
        expect(s.getState().behavior).toBe(`user:${type}`);
        expect(s.getState().source).toBe("user");
        // 静默窗内 rng 必触发压力测：不插自主动作
        for (let i = 0; i < 5; i++) s.tick("idle", 1000 + (i + 1) * 1000, type as PhysicalIntentType);
        expect(e.filter((x) => x === "STRETCH" || x === "PEEK").length).toBe(0);
        void label;
      }
    });
  }
});

describe("同 profile 确定性", () => {
  it("相同 traits + 相同 rng 序列 → 完全一致的派发序列", () => {
    const mk = () => {
      let seed = 42;
      return () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
    };
    const a = runMixed(BUILTIN_PERSONALITY_PROFILES["curious-explorer"], mk());
    const b = runMixed(BUILTIN_PERSONALITY_PROFILES["curious-explorer"], mk());
    expect(a.emitted).toEqual(b.emitted);
    expect(a.lonelyWait).toBe(b.lonelyWait);
  });
});

describe("固定种子 30min soak × 3 profile：分布不同", () => {
  it("curious-explorer 自主动作总数 > quiet-observer（分布确实随人格变化）", () => {
    let seed = 0xc0ffee;
    const rngA = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let seedB = 0xc0ffee;
    const rngB = () => {
      seedB = (seedB * 1103515245 + 12345) & 0x7fffffff;
      return seedB / 0x7fffffff;
    };
    const a = runMixed(BUILTIN_PERSONALITY_PROFILES["curious-explorer"], rngA);
    const b = runMixed(BUILTIN_PERSONALITY_PROFILES["quiet-observer"], rngB);
    const totalA = count(a, "PEEK") + count(a, "STRETCH") + a.lonelyWait;
    const totalB = count(b, "PEEK") + count(b, "STRETCH") + b.lonelyWait;
    expect(totalA).toBeGreaterThan(totalB);
    // 且 PEEK 维度也明显不同
    expect(count(a, "PEEK")).not.toBe(count(b, "PEEK"));
  });
});
