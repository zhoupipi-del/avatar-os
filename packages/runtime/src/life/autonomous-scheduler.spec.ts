// ============================================================
// AutonomousScheduler 单测 (v0.3.6-A)
// 全部使用注入时间 + 注入 RNG，调度完全确定性，逐条覆盖开工契约规则：
//   用户优先 / 睡眠禁动 / clip 播放不插入 / 同意图冷却 / 全局间隔 /
//   阶段默认意图去重 / 限时行为自动复位 / 可观测状态留痕
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  AutonomousScheduler,
  USER_QUIET_WINDOW_MS,
  GLOBAL_ONESHOT_GAP_MS,
  STRETCH_COOLDOWN_MS,
  type AutonomousEmitPayload,
} from "./autonomous-scheduler";

/** rng 恒返回 0 → 概率闸门必过（chancePerTick > 0 即触发） */
const alwaysFire = () => 0;
/** rng 恒返回 0.999 → 概率闸门必不过 */
const neverFire = () => 0.999;

function collect() {
  const emitted: AutonomousEmitPayload[] = [];
  return { emitted, emit: (p: AutonomousEmitPayload) => emitted.push(p) };
}

describe("AutonomousScheduler — 阶段默认意图", () => {
  it("阶段切换时派发默认意图；阶段不变不重复广播", () => {
    const { emitted, emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: neverFire });

    s.tick("idle", 1_000, null);
    expect(emitted).toEqual([{ type: "IDLE_BREATHE", intensity: 0.6 }]);

    // 同阶段 + 当前意图已是 IDLE_BREATHE → 零新事件
    s.tick("idle", 2_000, "IDLE_BREATHE");
    s.tick("idle", 3_000, "IDLE_BREATHE");
    expect(emitted).toHaveLength(1);

    // 切到 curious → 派发 LOOK_AT_USER
    s.tick("curious", 4_000, "IDLE_BREATHE");
    expect(emitted[1]).toEqual({ type: "LOOK_AT_USER", intensity: 0.5 });
  });

  it("当前生效意图与阶段默认相同时，阶段切换也不重发（意图级去重）", () => {
    const { emitted, emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: neverFire });
    // awake 与 curious 默认都是 LOOK_AT_USER —— 只是强度不同，类型相同不重发
    s.tick("awake", 1_000, "LOOK_AT_USER");
    expect(emitted).toHaveLength(0);
  });

  it("sleeping 阶段默认 DOZE，且禁止普通自主动作", () => {
    const { emitted, emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: alwaysFire });
    s.tick("sleeping", 1_000, null);
    expect(emitted).toEqual([{ type: "DOZE", intensity: 0.2 }]);
    // 之后 rng 必中也不允许任何 one-shot
    for (let t = 2; t < 400; t++) s.tick("sleeping", t * 1_000, "DOZE");
    expect(emitted).toHaveLength(1);
  });
});

describe("AutonomousScheduler — one-shot 行为与冷却", () => {
  it("idle 阶段能触发 STRETCH，且同一行为受冻结的 240s 冷却约束", () => {
    const { emitted, emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: alwaysFire });

    s.tick("idle", 1_000, null); // 默认 IDLE_BREATHE
    s.tick("idle", 2_000, "IDLE_BREATHE"); // → STRETCH（rng 必中），首次触发 @2000
    expect(emitted.map((e) => e.type)).toEqual(["IDLE_BREATHE", "STRETCH"]);

    // 冷却边界内（< 2000 + STRETCH_COOLDOWN_MS）：即使 rng 必中也不重发
    s.tick("idle", 2_000 + STRETCH_COOLDOWN_MS - 1_000, "IDLE_BREATHE"); // = 241_000
    s.tick("idle", 2_000 + STRETCH_COOLDOWN_MS - 500, "IDLE_BREATHE"); // = 241_500
    expect(emitted).toHaveLength(2);

    // 跨过冷却边界（= 242_000，cooldownUntil <= now 解锁）→ 允许再次
    s.tick("idle", 2_000 + STRETCH_COOLDOWN_MS, "IDLE_BREATHE");
    expect(emitted).toHaveLength(3);
    expect(emitted[2].type).toBe("STRETCH");
  });

  it("全局 one-shot 间隔：不同行为也不能背靠背连发", () => {
    const { emitted, emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: alwaysFire });

    s.tick("curious", 1_000, null); // 默认 LOOK_AT_USER
    s.tick("curious", 2_000, "LOOK_AT_USER"); // → PEEK one-shot
    expect(emitted.map((e) => e.type)).toEqual(["LOOK_AT_USER", "PEEK"]);

    // 立刻切 idle：阶段默认照发（持续意图不受 one-shot 间隔管制），
    // 但 STRETCH one-shot 必须等全局间隔(15s)结束
    s.tick("idle", 3_000, "PEEK");
    expect(emitted[2].type).toBe("IDLE_BREATHE");
    s.tick("idle", 4_000, "IDLE_BREATHE");
    expect(emitted).toHaveLength(3); // 全局间隔内无 one-shot

    s.tick("idle", 2_000 + GLOBAL_ONESHOT_GAP_MS + 1_000, "IDLE_BREATHE");
    expect(emitted[3].type).toBe("STRETCH");
  });

  it("active 阶段完全停止自主 one-shot（让路给用户）", () => {
    const { emitted, emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: alwaysFire });
    s.tick("active", 1_000, null); // 默认 LOOK_AT_USER
    for (let t = 2; t < 100; t++) s.tick("active", t * 1_000, "LOOK_AT_USER");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe("LOOK_AT_USER");
  });
});

describe("AutonomousScheduler — 用户优先与打断", () => {
  it("用户意图后进入静默窗口，期间不发自主 one-shot", () => {
    const { emitted, emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: alwaysFire });

    s.tick("idle", 1_000, null);
    s.notifyUserIntent("GREET", 1_500);

    // 静默窗口内 rng 必中也不发
    s.tick("idle", 2_000, "IDLE_BREATHE");
    s.tick("idle", 1_500 + USER_QUIET_WINDOW_MS - 500, "IDLE_BREATHE");
    expect(emitted.map((e) => e.type)).toEqual(["IDLE_BREATHE"]);

    // 窗口结束后恢复
    s.tick("idle", 1_500 + USER_QUIET_WINDOW_MS + 1_000, "IDLE_BREATHE");
    expect(emitted.map((e) => e.type)).toEqual(["IDLE_BREATHE", "STRETCH"]);
  });

  it("用户意图打断进行中的限时自主行为并留痕 interruptedBy", () => {
    const { emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: alwaysFire });

    s.tick("lonely", 1_000, null); // 默认 IDLE_BREATHE(0.35)
    s.tick("lonely", 2_000, "IDLE_BREATHE"); // → lonely-wait (LOOK_AT_USER, 6s 限时)
    expect(s.getState().behavior).toBe("lonely-wait");
    expect(s.getState().source).toBe("scheduler");

    s.notifyUserIntent("BOUNCE_HAPPY", 3_000);
    const st = s.getState();
    expect(st.interruptedBy).toBe("user:BOUNCE_HAPPY");
    expect(st.behavior).toBe("user:BOUNCE_HAPPY");
    expect(st.source).toBe("user");
  });

  it("限时自主行为到点自动复位回阶段默认意图", () => {
    const { emitted, emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: alwaysFire });

    s.tick("lonely", 1_000, null);
    s.tick("lonely", 2_000, "IDLE_BREATHE"); // lonely-wait 开始（6s）
    expect(emitted.map((e) => e.type)).toEqual(["IDLE_BREATHE", "LOOK_AT_USER"]);

    // 到点（2s + 6s = 8s）后复位默认 IDLE_BREATHE
    s.tick("lonely", 9_000, "LOOK_AT_USER");
    expect(emitted[2].type).toBe("IDLE_BREATHE");
    expect(s.getState().behavior).toBe("default:IDLE_BREATHE");
    expect(s.getState().source).toBe("life-state");
  });
});

describe("AutonomousScheduler — 显式动作播放期间不插入", () => {
  it("clipPlaying=true 时既不发 one-shot 也不复位默认意图", () => {
    const { emitted, emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: alwaysFire });

    s.notifyClipPlayback(true);
    s.tick("idle", 1_000, null); // 阶段切换但 clip 占身体 → 不发
    s.tick("idle", 2_000, null);
    expect(emitted).toHaveLength(0);

    // clip 播完 → 下一次阶段变化/复位恢复正常
    s.notifyClipPlayback(false);
    s.tick("curious", 3_000, null);
    expect(emitted[0]).toEqual({ type: "LOOK_AT_USER", intensity: 0.5 });
  });
});

describe("AutonomousScheduler — 可观测性", () => {
  it("状态无变化时 tick 返回 null（供上层免广播）", () => {
    const { emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: neverFire });
    expect(s.tick("idle", 1_000, null)).not.toBeNull();
    expect(s.tick("idle", 2_000, "IDLE_BREATHE")).toBeNull();
    expect(s.tick("idle", 3_000, "IDLE_BREATHE")).toBeNull();
  });

  it("cooldownUntil 反映全局 one-shot 冷却截止", () => {
    const { emit } = collect();
    const s = new AutonomousScheduler({ emit, rng: alwaysFire });
    s.tick("idle", 1_000, null);
    expect(s.getState().cooldownUntil).toBeNull();
    s.tick("idle", 2_000, "IDLE_BREATHE"); // STRETCH one-shot
    expect(s.getState().cooldownUntil).toBe(2_000 + GLOBAL_ONESHOT_GAP_MS);
  });
});
