// ============================================================
// life-phase — 离散生命阶段状态机 (v0.3.5-A Life State)
// ============================================================
// 这是 AvatarOS 第一次拥有"它会处于哪种生命状态"的单一事实源。
//
// 设计边界（与既有架构的关系，逐条理清）：
//   - primitives.LifeState 是【连续生理向量】(energy/socialNeed/pressures)，
//     归 DriveEngine 所有，供 Morphology 做渲染参数。它描述"数值上多累/多孤独"。
//   - LifePhase 是【离散阶段枚举】(awake/active/idle/curious/tired/lonely/sleeping)，
//     归本模块所有，描述"此刻它像在做什么样的一种生命"。
//   - 二者不冲突、不重名：DriveEngine 仍产 LifeState；本模块把 LifeState 的连续量
//     + 在场/交互信号，坍缩成一个离散阶段，作为"默认身体表现"与"快照可见状态"的单一驱动。
//
// 为什么需要它（解决用户指出的问题）：
//   - 此前 IDLE_BREATHE / LOOK_AT_USER 在 behavior-vm / behavior/vm 里被无条件零散发射，
//     每次 tick 复位都硬编码同一种呼吸。这里把它们收口为 phaseDefaultIntent(phase)，
//     由阶段决定"默认该做哪个动作、多强"，从根上消除零散与重复。
//   - 阶段切换做去重：LifePhaseMachine.transition 仅在阶段真正变化时才返回新值，
//     未变化返回 null —— 事件总线不会被重复刷屏。

import { PhysicalIntentType } from "@avatar-os/primitives";

/** 离散生命阶段。与连续 LifeState 区分，命名上不叫 LifeState。 */
export type LifePhase =
  | "awake" // 刚被唤醒/启动，警觉张望
  | "active" // 正在与用户互动
  | "idle" // 平静待机，缓慢呼吸
  | "curious" // 用户在场但未互动（晃鼠标）→ 好奇张望
  | "tired" // 能量偏低，略显疲态
  | "lonely" // 长时间无人理睬，孤独
  | "sleeping"; // 夜间+长时间无交互/低能量 → 沉睡

/** 阶段转移所需的实时信号（由 LifeLoop 每 tick 汇总）。 */
export interface LifePhaseSignals {
  /**
   * 用户正在与 Avatar 做【直接互动】（近 INTERACT_WINDOW_MS 内有说话/点击/触碰）。
   * 这是"刚互动→active"的触发源，与单纯的鼠标移动区分开。
   */
  userInteracting: boolean;
  /**
   * 用户在电脑前保持活跃（近 60s 内有鼠标/键盘活动），但未必直接碰 Avatar。
   * 这是"移鼠标→curious（观察）"的触发源：用户在附近动，宠物好奇张望。
   */
  userActive: boolean;
  /** 连续无实质活动的毫秒数（presence.idleTimeMs） */
  idleMs: number;
  /** 来自 DriveEngine 的连续能量 0~1 */
  energy: number;
  /** 来自 DriveEngine 的孤独压力 0~1（结构性累积，偏慢） */
  lonelinessPressure: number;
  /** 是否夜间（23:00–06:00） */
  isNight: boolean;
}

// —— 转移阈值（集中常量，便于调参与单测）——
const IDLE_CURIOUS_MS = 30_000; // 活跃但未直接互动 <30s → curious 张望
const IDLE_LONG_MS = 120_000; // 夜间长空闲 >2min → 睡眠
const LONELY_IDLE_MS = 90_000; // 久无人(>1.5min 无活跃) → lonely（时间兜底，独立于慢速压力模型）
const SLEEP_IDLE_MS = 300_000; // 白天久离(>5min) → 从 lonely/tired 转入打盹睡眠
const ENERGY_TIRED = 0.35; // 能量低于此 → tired
const ENERGY_RECOVERED = 0.6; // 能量高于此 → 从 tired 恢复
const LONELY_IN = 0.6; // 孤独压力高于此 → lonely
const LONELY_OUT = 0.3; // 孤独压力低于此 → 离开 lonely
const INTERACT_WINDOW_MS = 3000; // 近 3s 内有互动才算 interacting

/**
 * 纯函数：给定当前阶段 + 信号，算出下一阶段。
 * 不持有状态、无副作用 —— 便于穷举单测每条转移边。
 */
export function nextLifePhase(current: LifePhase, s: LifePhaseSignals): LifePhase {
  switch (current) {
    case "sleeping":
      // 醒来：用户互动或重新活跃 → awake（用户回来就醒，自然）
      if (s.userInteracting || s.userActive) return "awake";
      return "sleeping";

    case "awake":
      // 启动/刚醒：有互动→active，否则平静落到 idle
      return s.userInteracting ? "active" : "idle";

    case "active":
      if (s.energy < ENERGY_TIRED) return "tired";
      if (s.lonelinessPressure > LONELY_IN) return "lonely";
      if (!s.userInteracting) return "idle";
      return "active";

    case "idle":
      if (s.userInteracting) return "active";
      // 夜间长空闲优先睡眠
      if (s.isNight && s.idleMs > IDLE_LONG_MS) return "sleeping";
      // 结构性孤独压力 → lonely
      if (s.lonelinessPressure > LONELY_IN) return "lonely";
      // 久无人（时间兜底）→ lonely
      if (!s.userActive && s.idleMs > LONELY_IDLE_MS) return "lonely";
      // 用户活跃在附近但未直接互动 → 观察张望
      if (s.userActive && s.idleMs < IDLE_CURIOUS_MS) return "curious";
      if (s.energy < ENERGY_TIRED) return "tired";
      return "idle";

    case "curious":
      if (s.userInteracting) return "active";
      if (s.idleMs > IDLE_CURIOUS_MS) return "idle";
      if (s.lonelinessPressure > LONELY_IN) return "lonely";
      if (!s.userActive && s.idleMs > LONELY_IDLE_MS) return "lonely";
      return "curious";

    case "tired":
      if (s.userInteracting) return "active";
      if (s.isNight && s.idleMs > IDLE_LONG_MS) return "sleeping";
      if (s.idleMs > SLEEP_IDLE_MS && !s.userActive) return "sleeping";
      if (s.energy > ENERGY_RECOVERED) return "idle";
      return "tired";

    case "lonely":
      if (s.userInteracting) return "active";
      if (s.isNight && s.idleMs > IDLE_LONG_MS) return "sleeping";
      // 白天久离 → 安静下来打盹
      if (s.idleMs > SLEEP_IDLE_MS && !s.userActive) return "sleeping";
      if (s.lonelinessPressure < LONELY_OUT) return "idle";
      return "lonely";
  }
}

/**
 * 阶段 → 默认身体意图（统一取代零散 IDLE_BREATHE / LOOK_AT_USER）。
 * 这是"身体表现"的默认基线：阶段变化时，LifeLoop 用它对程序化层下达默认动作。
 */
export function phaseDefaultIntent(phase: LifePhase): { type: PhysicalIntentType; intensity: number } {
  switch (phase) {
    case "sleeping":
      return { type: "DOZE", intensity: 0.2 };
    case "tired":
      return { type: "IDLE_BREATHE", intensity: 0.4 };
    case "lonely":
      return { type: "IDLE_BREATHE", intensity: 0.35 };
    case "idle":
      return { type: "IDLE_BREATHE", intensity: 0.6 };
    case "curious":
      return { type: "LOOK_AT_USER", intensity: 0.5 };
    case "active":
      return { type: "LOOK_AT_USER", intensity: 0.85 };
    case "awake":
      return { type: "LOOK_AT_USER", intensity: 0.9 };
  }
}

/**
 * LifePhaseMachine — 持有当前阶段的轻量状态机。
 * 唯一职责：dedup 转移。transition() 仅在阶段真变化时才返回新值。
 */
export class LifePhaseMachine {
  private current: LifePhase;

  constructor(initial: LifePhase = "awake") {
    this.current = initial;
  }

  public get phase(): LifePhase {
    return this.current;
  }

  /** 推入信号；返回新阶段（变化）或 null（未变化，去重）。 */
  public transition(signals: LifePhaseSignals): LifePhase | null {
    const next = nextLifePhase(this.current, signals);
    if (next === this.current) return null;
    this.current = next;
    return next;
  }

  /** 外部强制设定（快照恢复用），返回是否真变化。 */
  public set(phase: LifePhase): boolean {
    if (phase === this.current) return false;
    this.current = phase;
    return true;
  }
}

export const INTERACTION_WINDOW_MS = INTERACT_WINDOW_MS;
