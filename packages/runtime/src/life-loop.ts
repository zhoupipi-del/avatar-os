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
import { PersonalityVector, DEFAULT_PERSONALITY } from "./personality";

/**
 * 在场微动作步进器契约（R2：由单一心跳驱动）。
 * 不依赖 @avatar-os/presence 以避免与 presence→runtime 形成循环依赖；
 * 任何拥有 step(nowMs, idleMs) 的对象（如 PresenceEngine）都可注入。
 */
export interface PresenceStepper {
  step(nowMs: number, idleMs: number): PhysicalIntentType | undefined;
}

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

  constructor(deps: LifeLoopDeps) {
    this.deps = deps;
    this.personality = deps.personality ?? DEFAULT_PERSONALITY;
    this.tickMs = deps.tickMs ?? 1000;
  }

  public start(): void {
    if (this.timer !== null) return;

    // 捕获内核仲裁出的 PhysicalIntent：注入形态层 + 落盘钩子
    this.unbindIntent = kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (intent: PhysicalIntent) => {
      this.morphology.setIntent(intent);
      this.deps.interactionLogger?.(intent);
    });

    this.timer = window.setInterval(() => this.tick(), this.tickMs);
  }

  public stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.unbindIntent?.();
    this.unbindIntent = null;
  }

  private tick(): void {
    const nowMs = Date.now();
    const presence: UserPresence =
      this.deps.presenceProvider != null ? this.deps.presenceProvider() : { ...DEFAULT_PRESENCE };
    const bonus = this.deps.interactionBonusProvider?.() ?? 0.0;

    // 1. 需求→压力 演算（含 PAD 情绪）
    const { state, emotionalState } = driveEngine.tick(this.tickMs, presence, this.personality, bonus);

    // 2. 兼容遗留总线：压力 tick 事件
    kernelEventBus.emit("DRIVE_PRESSURE_TICK", { timestamp: nowMs });

    // 3. Arbiter：评估规则 → 抢占仲裁 → 派发 PhysicalIntent
    behaviorVM.evaluate(state);
    behaviorVM.tick(this.tickMs);

    // 3.5 在场微动作节律（R2：纯步进，由本单一心跳驱动，无独立定时器）
    const rhythm = this.deps.presenceEngine?.step(nowMs, presence.idleTimeMs ?? 0);
    if (rhythm) {
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
