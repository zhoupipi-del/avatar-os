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
import { AutonomousScheduler } from "./life/autonomous-scheduler";
import { PersonalityVector, DEFAULT_PERSONALITY } from "./personality";
import {
  clampTraits,
  deriveBehaviorTuning,
  resolveProfileId,
  BUILTIN_PERSONALITY_PROFILES,
  DEFAULT_PERSONALITY_PROFILE_ID,
  type PersonalityTraits,
} from "./personality/behavior-tuning";

export interface LifeLoopDeps {
  /** 每 tick 采样真实在场信号（O1 修复入口） */
  presenceProvider: () => UserPresence;
  /** 性格向量，缺省用默认陪伴型人格 */
  personality?: PersonalityVector;
  /** 记忆甜度生产者（O6）：最近互动对孤独压力的缓解强度 0~1 */
  interactionBonusProvider?: () => number;
  /** 意图落盘钩子（如 PEEK 写入交互日志） */
  interactionLogger?: (intent: PhysicalIntent) => void;
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
  private unbindClip: (() => void) | null = null;
  private unbindPersonality: (() => void) | null = null;
  /** 离散生命阶段机（v0.3.5-A）：统一替代零散 IDLE_BREATHE/LOOK_AT_USER 发射 */
  private readonly phaseMachine = new LifePhaseMachine("awake");
  /** 自主行为调度器（v0.3.6-A）：收编原 PresenceEngine 的泊松节律，成为自主动作唯一发射口。
   *  自身零总线依赖；意图经注入的 emit 回调发到 PHYSICAL_INTENT_DISPATCH（source=DRIVE）。 */
  private readonly scheduler = new AutonomousScheduler({
    emit: (p) =>
      kernelEventBus.emit(
        "PHYSICAL_INTENT_DISPATCH",
        makeIntent({ type: p.type, intensity: p.intensity, source: "DRIVE" }),
      ),
  });
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
      // 用户/外部意图立即打断自主行为，进入静默窗口（v0.3.6-A 调度规则：用户行为优先级 > 自主行为）。
      // 来源识别（窄修复，不重开链路）：
      //   AI     = LLM 回复 / DebugConsole 身体自测 / Agent 提议（说话走此源）
      //   SENSOR = 用户点击"摸摸它"(BOUNCE_HAPPY, MouseSensor.ts)
      // 自主意图为 DRIVE；鼠标靠近走 SENSOR_MOUSE_NEAR(不发 PHYSICAL_INTENT_DISPATCH)，均不误触发。
      if (intent.source === "AI" || intent.source === "SENSOR") {
        this.scheduler.notifyUserIntent(intent.type, Date.now());
      }
    });

    // 显式动画片段播放状态：播放期间不插入自主动作，播完恢复阶段默认意图（防动作抢身体）。
    this.unbindClip = kernelEventBus.on("ANIMATION_CLIP_STATE", (p) => {
      this.scheduler.notifyClipPlayback(p.playing);
    });

    // 人格切换请求（v0.3.6-B）：唯一对外入口，由 DebugConsole dev-only 切换器发出。
    // 这里收口——套用调音到调度器并广播 CHANGED，保证调度器不被任何 UI 直接触碰。
    this.unbindPersonality = kernelEventBus.on("PERSONALITY_PROFILE_REQUEST", ({ traits }) => {
      const t = clampTraits(traits);
      this.scheduler.setPersonalityProfile(t);
      const tuning = deriveBehaviorTuning(t);
      const profileId = resolveProfileId(t);
      kernelEventBus.emit("PERSONALITY_PROFILE_CHANGED", { profileId, traits: t, tuning });
    });

    // 初始广播默认人格：让 Runtime Snapshot / DebugConsole 立即可见（调度器默认即中性=该 Profile）。
    {
      const t = BUILTIN_PERSONALITY_PROFILES[DEFAULT_PERSONALITY_PROFILE_ID];
      kernelEventBus.emit("PERSONALITY_PROFILE_CHANGED", {
        profileId: DEFAULT_PERSONALITY_PROFILE_ID,
        traits: t,
        tuning: deriveBehaviorTuning(t),
      });
    }

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
    this.unbindClip?.();
    this.unbindClip = null;
    this.unbindPersonality?.();
    this.unbindPersonality = null;
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

    // 3.5 自主行为调度（v0.3.6-A）：收编原 PresenceEngine 的泊松节律，成为阶段感知的单一发射口。
    // 持续型默认意图(呼吸/注视/打盹)与一次性自主动作(STRETCH/PEEK/LONELY_WAIT)均由它统一派发，
    // 经冷却/全局间隔/用户打断/剪辑占用全部闸门管制——根除"意图风暴"。
    // 仅状态有变化时返回快照，广播 AUTONOMOUS_BEHAVIOR_CHANGED 供 Runtime Snapshot / DebugConsole 观测。
    const schedState = this.scheduler.tick(this.phaseMachine.phase, nowMs, this.lastIntentType);
    if (schedState) kernelEventBus.emit("AUTONOMOUS_BEHAVIOR_CHANGED", { state: schedState });

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

/**
 * 唯一对外人格切换入口（v0.3.6-B）。发 REQUEST 事件，由 LifeLoop 收口套用调音并广播 CHANGED。
 * DebugConsole/BODY 切换器只调这一个函数——绝不触碰调度器内部，与身体切换同理（只触发、不拥有）。
 */
export function requestPersonalityProfile(traits: PersonalityTraits): void {
  kernelEventBus.emit("PERSONALITY_PROFILE_REQUEST", { traits });
}
