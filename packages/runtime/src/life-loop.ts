// ============================================================
// LifeLoop — 生命闭环编排器 (v0.1.0-alpha)
// ============================================================
// 蓝图里的"编排器"：把 7 层按 tick 串成真正的闭环，
// 而不是各自独立运行。每个 tick 的顺序即生命演化的因果链：
//
//   在场采样 → DriveEngine(Need→Pressure) → BehaviorVM(Arbiter) →
//   Morphology(意图+状态→渲染参数) → 事件广播(渲染/Mood/记忆)
//
// 它不持有任何状态（全部委托给各单例/注入依赖），只负责编排与
// 事件发射。这是从"技术 Demo"跨向"会自己活的数字生命"的关键齿轮。
// ============================================================

import { PhysicalIntent, PhysicalIntentType, makeIntent } from "@avatar-os/primitives";
import { UserPresence, DEFAULT_PRESENCE } from "@avatar-os/sensor";
import { MorphologyEngine } from "@avatar-os/morphology";
import { kernelEventBus } from "./event-bus";
import { driveEngine } from "./drive-engine";
import { behaviorVM } from "./behavior-vm";
import { LifePhaseMachine, type LifePhaseSignals, INTERACTION_WINDOW_MS } from "./life/life-phase";
import { PersonalityVector, DEFAULT_PERSONALITY } from "./personality";

/**
 * 在场微动作步进器契约（R2：由单一心跳驱动）。
 * 不依赖 @avatar-os/presence 以避免与 presence→runtime 形成循环依赖；
 * 任何拥有 step(nowMs, idleMs) 的对象（如 PresenceEngine）都可注入。
 */
export interface PresenceStepper {
  step(nowMs: number, idleMs: number): PhysicalIntentType | undefined;
}

/**
 * 持续型意图集合（v0.3.5-A 去重依据）：
 * 这些意图表达"一种持续状态"而非"一次动作"，下游消费全幂等
 * （morphology 覆盖赋值 / embodiment 编译为空 / 遗留 FSM 忽略），
 * 因此与当前生效意图相同时重发没有任何效果，只会刷事件噪声。
 */
const SUSTAINED_INTENTS: ReadonlySet<PhysicalIntentType> = new Set([
  "IDLE_BREATHE",
  "LOOK_AT_USER",
  "DOZE",
]);

export interface LifeLoopDeps {
  /** 每 tick 采样真实在场信号（O1 修复入口） */
  presenceProvider: () => UserPresence;
  /** 性格向量，缺省用默认陪伴型人格 */
  personality?: PersonalityVector;
  /** 记忆甜度生产者（O6）：最近互动对孤独压力的缓解强度 0~1 */
  interactionBonusProvider?: () => number;
  /** 意图落盘钩子（如 PEEK 写入交互日志） */
  interactionLogger?: (intent: PhysicalIntent) => void;
  /** 在场微动作节律步进器（R2：由单一心跳驱动，无独立定时器） */
  presenceEngine?: PresenceStepper;
  /** tick 间隔(ms)，缺省 1000 */
  tickMs?: number;
}

export class LifeLoop {
  private timer: number | null = null;
  private readonly morphology = new MorphologyEngine();
  private readonly personality: PersonalityVector;
  private readonly deps: LifeLoopDeps;
  private readonly tickMs: number;
  private unbindIntent: (() => void) | null = null;
  private unbindInteraction: (() => void) | null = null;
  /** 离散生命阶段机（v0.3.5-A）：统一替代零散 IDLE_BREATHE/LOOK_AT_USER 发射 */
  private readonly phaseMachine = new LifePhaseMachine("awake");
  /** 最近一次"实质交互"（说话/近场）的时间戳，用于推导 userInteracting */
  private lastInteractionAt = 0;
  /** 当前生效的意图类型（跟踪自 PHYSICAL_INTENT_DISPATCH），用于持续型意图去重 */
  private lastIntentType: PhysicalIntentType | null = null;

  constructor(deps: LifeLoopDeps) {
    this.deps = deps;
    this.personality = deps.personality ?? DEFAULT_PERSONALITY;
    this.tickMs = deps.tickMs ?? 1000;
  }

  public start(): void {
    if (this.timer !== null) return;

    // 捕获内核仲裁出的 PhysicalIntent：注入形态层 + 落盘钩子
    // 同时把"用户主动触碰"(BOUNCE_HAPPY，如点"摸摸它")记为实质互动 → active 阶段
    this.unbindIntent = kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (intent: PhysicalIntent) => {
      this.morphology.setIntent(intent);
      this.lastIntentType = intent.type;
      this.deps.interactionLogger?.(intent);
      if (intent.type === "BOUNCE_HAPPY") this.lastInteractionAt = Date.now();
    });

    // 实质互动信号：说话 → 刷新 lastInteractionAt（驱动 active 阶段）。
    // 注意：SENSOR_MOUSE_NEAR（光标靠近）只算"在场/好奇"，不算"互动"，
    // 避免把"移鼠标→curious"错判成 active —— curious 由 userActive 驱动。
    const markInteraction = () => {
      this.lastInteractionAt = Date.now();
    };
    const uInput = kernelEventBus.on("SPEECH_INPUT", markInteraction);
    this.unbindInteraction = () => {
      uInput();
    };

    this.timer = window.setInterval(() => this.tick(), this.tickMs);
  }

  public stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.unbindIntent?.();
    this.unbindIntent = null;
    this.unbindInteraction?.();
    this.unbindInteraction = null;
  }

  private tick(): void {
    const nowMs = Date.now();
    const presence: UserPresence =
      this.deps.presenceProvider != null ? this.deps.presenceProvider() : { ...DEFAULT_PRESENCE };
    const bonus = this.deps.interactionBonusProvider?.() ?? 0.0;

    // 1. 需求→压力 演算（含 PAD 情绪）
    const { state, emotionalState } = driveEngine.tick(this.tickMs, presence, this.personality, bonus);

    // 2.5 统一生命阶段机（v0.3.5-A）：把连续 LifeState + 在场/交互信号坍缩成离散阶段，
    //     阶段切换做去重（transition 仅在变化时返回新值），广播 LIFE_PHASE_CHANGED。
    const hour = new Date().getHours();
    const isNight = hour >= 23 || hour < 6;
    const phaseSignals: LifePhaseSignals = {
      userInteracting: nowMs - this.lastInteractionAt < INTERACTION_WINDOW_MS,
      userActive: presence.focusState !== "AWAY",
      idleMs: presence.idleTimeMs ?? 0,
      energy: state.energy,
      lonelinessPressure: state.pressures.lonelinessPressure,
      isNight,
    };
    const newPhase = this.phaseMachine.transition(phaseSignals);
    if (newPhase) kernelEventBus.emit("LIFE_PHASE_CHANGED", { phase: newPhase });
    // 同步阶段给行为 VM：其复位默认意图（IDLE_BREATHE/LOOK_AT_USER/DOZE）由阶段决定
    behaviorVM.setPhase(this.phaseMachine.phase);

    // 3. 兼容遗留总线：压力 tick 事件
    kernelEventBus.emit("DRIVE_PRESSURE_TICK", { timestamp: nowMs });

    // 4. Arbiter：评估规则 → 抢占仲裁 → 派发 PhysicalIntent
    behaviorVM.evaluate(state);
    behaviorVM.tick(this.tickMs);

    // 3.5 在场微动作节律（R2：纯步进，由本单一心跳驱动，无独立定时器）
    // v0.3.5-A 去重：持续型意图（呼吸/注视/打盹）与当前生效意图相同时不再重发——
    // 下游全幂等（morphology 覆盖赋值、embodiment 编译为空、FSM 忽略），重发＝纯事件噪声。
    // 一次性动作（GREET/STRETCH/PEEK/BOUNCE_HAPPY）不去重，每次派发都有真实动作。
    const rhythm = this.deps.presenceEngine?.step(nowMs, presence.idleTimeMs ?? 0);
    if (rhythm && !(SUSTAINED_INTENTS.has(rhythm) && rhythm === this.lastIntentType)) {
      kernelEventBus.emit(
        "PHYSICAL_INTENT_DISPATCH",
        makeIntent({ type: rhythm, intensity: 0.3, source: "DRIVE" }),
      );
    }

    // 4. Morphology：意图+状态 → 渲染参数
    const params = this.morphology.render(state, emotionalState);
    kernelEventBus.emit("STATE_MOTION_CHANGED", { motion: params.motion });
    kernelEventBus.emit("STATE_RENDER_PARAMS_CHANGED", {
      eyeOpenRatio: params.eyeOpenRatio,
      bodyScale: params.bodyScale,
      gazeBias: params.gazeBias,
    });
  }
}
