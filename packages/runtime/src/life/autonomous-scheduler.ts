// ============================================================
// AutonomousScheduler — 自主行为调度器 (v0.3.6-A)
// ============================================================
// 生命阶段(LifePhase) → 候选自主行为 → 优先级/冷却/去重/打断 → PhysicalIntent。
//
// 它是"自主动作的唯一发射口"：收编 v0.1 时代 PresenceEngine 的
// 与阶段无关的泊松节律（意图风暴根源），统一为阶段感知的调度。
//
// 设计纪律：
//   1. 纯逻辑类：不 import kernelEventBus、不认识 three/渲染层。
//      意图经注入的 emit 回调发出，时间与随机数可注入 → 全部可单测。
//   2. 只用当前已存在的通用意图（IDLE_BREATHE/LOOK_AT_USER/DOZE/
//      PEEK/STRETCH），不新增动画资产。
//   3. clip 缺失降级不在这里做 —— EmbodimentRuntime 的有序候选链
//      (clipFor→leanFor/tiltFor) 已保证任何身体拿到意图都能安全降级，
//      调度器对身体是谁保持零知识（bag/warrior 无特判）。
//
// 调度规则（第一版，与开工契约逐条对应）：
//   - 用户行为优先级 > 自主行为：用户意图(source=AI 或 SENSOR，由 life-loop 路由到 notifyUserIntent)后
//     USER_QUIET_WINDOW_MS 内不发任何自主 one-shot，且立即打断进行中的自主行为；
//   - 睡眠行为优先级 > 普通 idle：sleeping 阶段只保持 DOZE，禁止普通自主动作；
//   - 显式动作播放期间不插入：clipPlaying=true 时既不发 one-shot 也不复位默认意图；
//   - 相同意图有冷却：每个行为独立 cooldownMs + 全局 one-shot 间隔 GLOBAL_ONESHOT_GAP_MS；
//   - 状态没有变化不重复广播：持续型默认意图与当前生效意图相同时不重发。
// ============================================================

import type { PhysicalIntentType } from "@avatar-os/primitives";
import { phaseDefaultIntent, type LifePhase } from "./life-phase";
import {
  applyTuning,
  clampTraits,
  deriveBehaviorTuning,
  NEUTRAL_TRAITS,
  type PersonalityTraits,
} from "../personality/behavior-tuning";

/** 一条自主行为定义（数据驱动：调频率/加行为只改表，不改逻辑） */
export interface AutonomousBehaviorDef {
  /** 行为 id（可观测性用，如 "idle-stretch"） */
  id: string;
  /** 派发的物理意图（只允许既有通用意图） */
  intent: PhysicalIntentType;
  intensity: number;
  /** 允许触发的生命阶段 */
  phases: readonly LifePhase[];
  /** 同一行为再次触发的最短间隔 */
  cooldownMs: number;
  /** 每 tick 触发概率（泊松近似；tick=1s） */
  chancePerTick: number;
  /**
   * 持续时长(ms)：设置后行为结束时自动复位回阶段默认意图
   * （如 lonely 的"看向用户、短暂等待"）；不设则为瞬时 one-shot。
   */
  durationMs?: number;
}

/**
 * 第一版 阶段→行为 映射（开工契约冻结）：
 *   awake  → 阶段默认意图已是强注视（无额外行为）
 *   active → 停止自主行为，优先响应用户（无条目 + tick 硬闸）
 *   curious→ PEEK 偶尔偷看
 *   idle   → 偶尔 STRETCH（IDLE_BREATHE 为阶段默认持续意图）
 *   lonely → LOOK_AT_USER 短暂等待（明显但克制；暂不主动调 LLM 说话）
 *   tired  → 降低频率：无 one-shot，仅低强度呼吸默认意图
 *   sleeping→ DOZE 为默认意图，禁止普通自主动作（tick 硬闸）
 */
/** STRETCH 冷却：v0.3.6-A 产品闸门冻结 240s。30min 纯 idle 理论 ~6~7 次（≤8 验收线）。导出供测试引用，避免生产/测试常数漂移。 */
export const STRETCH_COOLDOWN_MS = 240_000;

export const DEFAULT_AUTONOMOUS_BEHAVIORS: readonly AutonomousBehaviorDef[] = [
  {
    id: "curious-peek",
    intent: "PEEK",
    intensity: 0.6,
    phases: ["curious"],
    cooldownMs: 25_000,
    chancePerTick: 0.15,
  },
  {
    id: "idle-stretch",
    intent: "STRETCH",
    intensity: 0.5,
    phases: ["idle"],
    cooldownMs: STRETCH_COOLDOWN_MS,
    chancePerTick: 0.05,
  },
  {
    id: "lonely-wait",
    intent: "LOOK_AT_USER",
    intensity: 0.5,
    phases: ["lonely"],
    cooldownMs: 45_000,
    chancePerTick: 0.1,
    durationMs: 6_000,
  },
];

/** 用户意图后的静默窗口：期间不发任何自主 one-shot */
export const USER_QUIET_WINDOW_MS = 6_000;
/** 任意两个自主 one-shot 之间的全局最短间隔（防连续小动作显得多动） */
export const GLOBAL_ONESHOT_GAP_MS = 15_000;
/** 完全禁止自主 one-shot 的阶段（active=让路给用户；sleeping=保持安静） */
const NO_ONESHOT_PHASES: ReadonlySet<LifePhase> = new Set(["active", "sleeping"]);

/** 可观测性快照（进 Runtime Snapshot / DebugConsole，出问题不再靠猜） */
export interface AutonomousSchedulerState {
  /** 当前自主行为（行为 id 或 default:意图名）；无 = null */
  behavior: string | null;
  /** 触发方：user(用户意图接管) / life-state(阶段默认) / scheduler(自主 one-shot) */
  source: "user" | "life-state" | "scheduler" | null;
  /** 当前行为开始时间(ms) */
  startedAt: number | null;
  /** 全局 one-shot 冷却截止(ms)；null = 无冷却 */
  cooldownUntil: number | null;
  /** 最近一次打断者（如 "user:GREET"）；null = 未被打断过 */
  interruptedBy: string | null;
}

export interface AutonomousEmitPayload {
  type: PhysicalIntentType;
  intensity: number;
}

export interface AutonomousSchedulerOptions {
  /** 意图发射回调（由 LifeLoop 注入 → kernelEventBus）；调度器自身零总线依赖 */
  emit: (payload: AutonomousEmitPayload) => void;
  /** 随机数源，缺省 Math.random；单测注入常量使调度确定性 */
  rng?: () => number;
  /** 行为表，缺省由人格派生(中性=冻结基线) */
  behaviors?: readonly AutonomousBehaviorDef[];
  /**
   * 人格特征：缺省中性(= v0.3.6-A 冻结参数)。
   * 与 behaviors 互斥——显式传 behaviors 时人格不生效(单测用)。
   */
  personality?: PersonalityTraits;
}

export class AutonomousScheduler {
  private readonly emit: (payload: AutonomousEmitPayload) => void;
  private readonly rng: () => number;
  private behaviors: readonly AutonomousBehaviorDef[];

  private lastPhase: LifePhase | null = null;
  private lastUserIntentAt = -Infinity;
  private clipPlaying = false;
  private lastOneshotAt = -Infinity;
  private readonly lastFiredAt = new Map<string, number>();
  /** 进行中的限时自主行为（durationMs 型），到点复位阶段默认意图 */
  private activeTimed: { def: AutonomousBehaviorDef; until: number } | null = null;

  private state: AutonomousSchedulerState = {
    behavior: null,
    source: null,
    startedAt: null,
    cooldownUntil: null,
    interruptedBy: null,
  };

  constructor(opts: AutonomousSchedulerOptions) {
    this.emit = opts.emit;
    this.rng = opts.rng ?? Math.random;
    this.behaviors =
      opts.behaviors ??
      applyTuning(DEFAULT_AUTONOMOUS_BEHAVIORS, deriveBehaviorTuning(clampTraits(opts.personality ?? NEUTRAL_TRAITS)));
  }

  /**
   * 运行时切换人格：重新派生有效行为表。
   * 只"调音"——替换行为表，绝不绕过调度器直接发意图。
   * 不触碰 lastFiredAt / 静默窗 / 进行中行为等运行态（行为 id 不变，冷却累计连续）。
   */
  public setPersonalityProfile(traits: PersonalityTraits): void {
    this.behaviors = applyTuning(DEFAULT_AUTONOMOUS_BEHAVIORS, deriveBehaviorTuning(clampTraits(traits)));
  }

  /** 只读可观测快照 */
  public getState(): AutonomousSchedulerState {
    return { ...this.state };
  }

  /**
   * 用户意图到来（source=AI）：立即打断自主行为并进入静默窗口。
   * 调度器不重发用户意图（Arbiter 已派发），只让路 + 留痕。
   */
  public notifyUserIntent(type: string, nowMs: number): void {
    this.lastUserIntentAt = nowMs;
    if (this.activeTimed) {
      this.state.interruptedBy = `user:${type}`;
      this.activeTimed = null;
    }
    this.state.behavior = `user:${type}`;
    this.state.source = "user";
    this.state.startedAt = nowMs;
  }

  /** 显式动作(clip)播放状态变化：播放期间不插入任何自主动作 */
  public notifyClipPlayback(playing: boolean): void {
    const wasPlaying = this.clipPlaying;
    this.clipPlaying = playing;
    // clip 播完 → 下一 tick 刷新阶段默认意图（"恢复站姿"；有意图级去重不会刷屏）
    if (wasPlaying && !playing) this.needsDefaultRefresh = true;
  }

  private needsDefaultRefresh = false;

  /**
   * 由 LifeLoop 单心跳每 tick 调用一次。
   * @param phase 当前生命阶段（LifePhaseMachine 的事实）
   * @param nowMs 当前时间
   * @param currentIntentType 当前生效意图（去重依据；LifeLoop 跟踪自总线）
   * @returns 状态有变化则返回新快照（供广播），无变化返回 null
   */
  public tick(
    phase: LifePhase,
    nowMs: number,
    currentIntentType: PhysicalIntentType | null,
  ): AutonomousSchedulerState | null {
    const before = JSON.stringify(this.state);
    /** 本 tick 是否已派发默认意图（同 tick 不再追加 one-shot，防两动作抢身体） */
    let defaultDispatched = false;

    // 1) 限时自主行为到点 → 复位回阶段默认意图
    if (this.activeTimed && nowMs >= this.activeTimed.until) {
      this.activeTimed = null;
      this.emitPhaseDefault(phase, nowMs, currentIntentType);
      defaultDispatched = true;
    }

    // 2) 阶段变化 / clip 播完恢复站姿 → 派发新阶段默认意图（意图级去重防刷屏）
    if (phase !== this.lastPhase || (this.needsDefaultRefresh && !this.clipPlaying)) {
      this.lastPhase = phase;
      this.needsDefaultRefresh = false;
      this.activeTimed = null; // 阶段切换终止旧的限时行为
      this.emitPhaseDefault(phase, nowMs, currentIntentType);
      defaultDispatched = true;
    }

    // 3) 自主 one-shot 选择（全部闸门按契约顺序）
    const userQuiet = nowMs - this.lastUserIntentAt < USER_QUIET_WINDOW_MS;
    const globalCooling = nowMs - this.lastOneshotAt < GLOBAL_ONESHOT_GAP_MS;
    if (
      !defaultDispatched && // 同 tick 已派发默认意图 → 不追加动作（防抢身体）
      !this.clipPlaying && // 显式动作播放期间不插入
      !userQuiet && // 用户行为优先
      !globalCooling && // 全局间隔
      !this.activeTimed && // 已有限时行为进行中
      !NO_ONESHOT_PHASES.has(phase) // active/sleeping 硬闸
    ) {
      for (const def of this.behaviors) {
        if (!def.phases.includes(phase)) continue;
        const last = this.lastFiredAt.get(def.id) ?? -Infinity;
        if (nowMs - last < def.cooldownMs) continue; // 同一意图冷却
        if (this.rng() >= def.chancePerTick) continue;

        this.emit({ type: def.intent, intensity: def.intensity });
        this.lastFiredAt.set(def.id, nowMs);
        this.lastOneshotAt = nowMs;
        if (def.durationMs) this.activeTimed = { def, until: nowMs + def.durationMs };

        this.state.behavior = def.id;
        this.state.source = "scheduler";
        this.state.startedAt = nowMs;
        break; // 一次 tick 至多一个行为（防抢身体）
      }
    }

    // 4) 冷却可观测性（全局 one-shot 间隔）
    this.state.cooldownUntil =
      this.lastOneshotAt === -Infinity ? null : this.lastOneshotAt + GLOBAL_ONESHOT_GAP_MS;

    return JSON.stringify(this.state) !== before ? this.getState() : null;
  }

  /** 派发阶段默认持续意图（与当前生效意图相同时不重发 = 去重） */
  private emitPhaseDefault(
    phase: LifePhase,
    nowMs: number,
    currentIntentType: PhysicalIntentType | null,
  ): void {
    if (this.clipPlaying) return; // 显式动作期间不复位，播完由 AnimationManager 自动回 idle
    const def = phaseDefaultIntent(phase);
    if (def.type !== currentIntentType) {
      this.emit({ type: def.type, intensity: def.intensity });
    }
    this.state.behavior = `default:${def.type}`;
    this.state.source = "life-state";
    this.state.startedAt = nowMs;
  }
}
