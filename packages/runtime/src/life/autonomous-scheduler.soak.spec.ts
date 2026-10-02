// ============================================================
// AutonomousScheduler — 30 分钟模拟 soak test (v0.3.6-A)
// ============================================================
// 用确定性模拟替代 30 分钟人工盯屏：
//   - mulberry32 固定种子 PRNG → 调度结果完全可重复
//   - fake clock：手工推进 nowMs，不真实等待
//   - 模拟 1800 次 1s tick（=30 分钟）
// 断言覆盖产品闸门稳定性验收线，单次 `pnpm test` 即可复验。
// ============================================================

import { describe, it, expect } from "vitest";
import { AutonomousScheduler, STRETCH_COOLDOWN_MS } from "./autonomous-scheduler";
import type { LifePhase } from "./life-phase";
import type { PhysicalIntentType } from "@avatar-os/primitives";

/** 固定种子 PRNG（mulberry32）→ 调度完全确定性 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ONE_SHOT: ReadonlySet<PhysicalIntentType> = new Set([
  "PEEK",
  "STRETCH",
  "GREET",
  "BOUNCE_HAPPY",
]);

const TICK_MS = 1000;
const TOTAL_TICKS = 1800; // 30 min @ 1s/tick

describe("AutonomousScheduler — 30 分钟模拟 soak（确定性）", () => {
  it("纯 idle 1800 tick：STRETCH ≤ 8、相邻间隔 ≥ 240s、无风暴、无连续重复 one-shot", () => {
    let now = 0;
    const emitted: { type: PhysicalIntentType; t: number }[] = [];
    const rng = mulberry32(0xc0ffee);
    const s = new AutonomousScheduler({
      emit: (p) => emitted.push({ type: p.type, t: now }),
      rng,
    });

    // LifeLoop 从总线跟踪 lastIntentType 回灌给 tick（持续型意图去重依据）
    let currentIntent: PhysicalIntentType | null = null;
    for (let i = 0; i < TOTAL_TICKS; i++) {
      now = i * TICK_MS;
      const before = emitted.length;
      s.tick("idle", now, currentIntent);
      for (let k = before; k < emitted.length; k++) currentIntent = emitted[k].type;
    }

    const stretches = emitted.filter((e) => e.type === "STRETCH").map((e) => e.t);

    // 验收线：≥ 1 次（确有自主动作）且 ≤ 8 次（不频发）
    expect(stretches.length).toBeGreaterThan(0);
    expect(stretches.length).toBeLessThanOrEqual(8);
    // 相邻 STRETCH 间隔 ≥ 240s（cooldown 落地 = 无连续重复 one-shot）
    for (let i = 1; i < stretches.length; i++) {
      expect(stretches[i] - stretches[i - 1]).toBeGreaterThanOrEqual(STRETCH_COOLDOWN_MS);
    }
    // 无意图风暴：30 分钟派发总数有界（阶段默认 1 次 + STRETCH ≤ 8）
    expect(emitted.length).toBeLessThanOrEqual(10);
    // 数组维度：任意相邻两个 one-shot 不得为同类型紧邻（时间维度由 cooldown 保证）
    for (let i = 1; i < emitted.length; i++) {
      const a = emitted[i - 1].type;
      const b = emitted[i].type;
      if (ONE_SHOT.has(a) && ONE_SHOT.has(b)) {
        expect(emitted[i].t - emitted[i - 1].t).toBeGreaterThanOrEqual(STRETCH_COOLDOWN_MS);
      }
    }
  });

  it("active 阶段不触发任何自主 one-shot（让路给用户）", () => {
    let now = 0;
    const e: PhysicalIntentType[] = [];
    const s = new AutonomousScheduler({ emit: (p) => e.push(p.type), rng: mulberry32(7) });
    for (let i = 0; i < 300; i++) {
      now = i * TICK_MS;
      s.tick("active", now, null);
    }
    expect(e.filter((t) => t === "STRETCH" || t === "PEEK").length).toBe(0);
  });

  it("sleeping 阶段不触发任何自主 one-shot（保持安静）", () => {
    let now = 0;
    const e: PhysicalIntentType[] = [];
    const s = new AutonomousScheduler({ emit: (p) => e.push(p.type), rng: mulberry32(9) });
    for (let i = 0; i < 300; i++) {
      now = i * TICK_MS;
      s.tick("sleeping", now, null);
    }
    expect(e.filter((t) => t === "STRETCH" || t === "PEEK").length).toBe(0);
  });

  it("clip 播放期间不插入任何自主动作", () => {
    let now = 0;
    const e: { type: PhysicalIntentType; t: number }[] = [];
    const s = new AutonomousScheduler({
      emit: (p) => e.push({ type: p.type, t: now }),
      rng: mulberry32(11),
    });
    s.notifyClipPlayback(true);
    for (let i = 0; i < 300; i++) {
      now = i * TICK_MS;
      s.tick("idle", now, null);
    }
    expect(e.filter((x) => x.type === "STRETCH" || x.type === "PEEK").length).toBe(0);
  });

  it("AI(GREET) 与 SENSOR(BOUNCE_HAPPY) 两类用户意图都能接管并进入静默窗", () => {
    // 调度器对来源零知识：life-loop 已把 AI(AgentSandbox) 与 SENSOR(MouseSensor 点击)
    // 都路由到 notifyUserIntent。此处断言两类"用户发起意图"都正确接管身体 + 建立静默窗。
    const s = new AutonomousScheduler({ emit: () => {}, rng: () => 0.999 });
    s.notifyUserIntent("GREET", 1000);
    let st = s.getState();
    expect(st.behavior).toBe("user:GREET");
    expect(st.source).toBe("user");

    s.notifyUserIntent("BOUNCE_HAPPY", 2000);
    st = s.getState();
    expect(st.behavior).toBe("user:BOUNCE_HAPPY");
    expect(st.source).toBe("user");

    // 静默窗生效（rng 恒触发压力测）：AI 与 SENSOR 意图后 6s 内均不插自主动作
    const e: PhysicalIntentType[] = [];
    const s2 = new AutonomousScheduler({ emit: (p) => e.push(p.type), rng: () => 0 });
    s2.notifyUserIntent("GREET", 1000);
    for (let i = 0; i < 5; i++) s2.tick("idle", 1000 + i * 1000, "GREET");
    s2.notifyUserIntent("BOUNCE_HAPPY", 6_000);
    for (let i = 0; i < 5; i++) s2.tick("idle", 6_000 + i * 1000, "BOUNCE_HAPPY");
    expect(e.filter((t) => t === "STRETCH" || t === "PEEK").length).toBe(0);
  });

  it("用户打断后进入 6s 静默窗，期间不重发自主 one-shot", () => {
    let now = 0;
    const e: { type: PhysicalIntentType; t: number }[] = [];
    const s = new AutonomousScheduler({
      emit: (p) => e.push({ type: p.type, t: now }),
      rng: () => 0, // 恒触发，专门压力测静默窗
    });
    s.notifyUserIntent("GREET", 1000);
    for (let i = 0; i < 5; i++) {
      now = 1000 + i * TICK_MS;
      s.tick("idle", now, "GREET");
    }
    expect(e.filter((x) => x.type === "STRETCH" || x.type === "PEEK").length).toBe(0);
  });
});
