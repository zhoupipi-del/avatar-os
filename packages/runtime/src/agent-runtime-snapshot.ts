// ============================================================
// agent-runtime-snapshot — AvatarOS 只读生命体监护仪 (v0.3.1.1)
// ============================================================
// 这是 v0.3.1.1 的全部资产：一个"能回答它现在为什么这样动"的只读快照。
//
// 设计红线（与 BOSS 拍板一致，逐条冻结）：
//   ❌ 不新增 Store / Redux / Zustand        —— 这里没有订阅、没有通知、没有响应式
//   ❌ 不新增 EventBus                        —— 只订阅已存在的 kernelEventBus
//   ❌ 不修改 Cognition / BehaviorVM / AvatarAdapter
//   ❌ 不做轮询（无 setInterval 刷新）        —— 纯事件驱动，哪里发生事件哪里留痕
//   ❌ 不写回任何状态                         —— 与 snapshot-manager.ts 的崩溃恢复/写回无关
//
// 它只"采集已有状态"。下面每一个字段都来自一条【已存在】的事件；
// 任何字段若没有真实来源，就保持 null —— 绝不编造数字（这是本模块最重要的纪律）。

import type { LifePhase } from "./life/life-phase";
import type { AutonomousSchedulerState } from "./life/autonomous-scheduler";
import type { PersonalityProfileId, PersonalityTraits, AutonomousBehaviorTuning } from "./personality/behavior-tuning";
import type { EmotionState } from "./emotion/emotion-state";

export interface AgentRuntimeSnapshot {
  cognition: {
    /** 最近一次归一化后的意图（来源：INTENT_NORMALIZED.normalized） */
    lastIntent: string | null;
    /**
     * 大脑判断的置信度。
     * 当前 Cognition 引擎不产出置信度，故保持 null —— 不伪造数值。
     * 一旦引擎在未来的事件里携带置信度，此处即可填充，无需改结构。
     */
    confidence: number | null;
    /** 最近一次说出口的话（来源：AVATAR_THOUGHT kind="speech"） */
    speech: string | null;
  };
  behavior: {
    /** 当前正在执行的物理意图（来源：PHYSICAL_INTENT_DISPATCH.type） */
    currentAction: string | null;
    /** 当前播放的动画片段名（来源：AVATAR_PRIMITIVE PLAY_ANIMATION 的 detail="clip=..."） */
    currentClip: string | null;
  };
  avatar: {
    /** 当前正在播放的动画（与 currentClip 同源；非 null 即视为"playing"） */
    animation: string | null;
    /** 当前情绪（来源：STATE_MOOD_CHANGED.mood） */
    mood: string | null;
    /**
     * 当前激活的身体 profile id（来源：AvatarService.activeId）。
     * 非事实源——事实在 AvatarService；此处由 DebugConsole 旁路订阅写入，
     * 与上面各字段同为"只读镜像"，便于在一处监护仪里看清"大脑驱动的是哪副身体"。
     */
    activeAvatarId: string | null;
  };
  /** 当前离散生命阶段（来源：LIFE_PHASE_CHANGED.phase）。统一替代零散 IDLE_BREATHE/LOOK_AT_USER 发射。 */
  life: {
    phase: LifePhase | null;
  };
  /** 自主行为调度器状态（来源：AUTONOMOUS_BEHAVIOR_CHANGED.state）。出问题不再靠猜。 */
  autonomous: AutonomousSchedulerState | null;
  /** 当前生效人格（来源：PERSONALITY_PROFILE_CHANGED）。仅人格切换时写入，绝不轮询。 */
  personality: {
    profileId: PersonalityProfileId | null;
    traits: PersonalityTraits;
    tuning: AutonomousBehaviorTuning;
  } | null;
  /** 当前情绪状态（来源：EMOTION_STATE_CHANGED.state）。每 tick 由 life-loop 驱动后写入，绝不轮询。 */
  emotion: EmotionState | null;
  /** 最近一次留痕的时间戳（ms） */
  timestamp: number;
}

/** 初始快照：全 null。任何真实值都必须由事件写入，从不预填。 */
export function createInitialSnapshot(): AgentRuntimeSnapshot {
  return {
    cognition: { lastIntent: null, confidence: null, speech: null },
    behavior: { currentAction: null, currentClip: null },
    avatar: { animation: null, mood: null, activeAvatarId: null },
    life: { phase: null },
    autonomous: null,
    personality: null,
    emotion: null,
    timestamp: 0,
  };
}

// —— 纯函数式写入 ——
// 没有副作用、没有订阅、没有全局状态：输入旧快照 + 一个真实事件值，返回新快照。
// 全部可单测、可复用（v0.3.2 Animation Inspector 会直接 import 这些函数）。

export function recordIntent(s: AgentRuntimeSnapshot, normalized: string): AgentRuntimeSnapshot {
  return { ...s, cognition: { ...s.cognition, lastIntent: normalized }, timestamp: Date.now() };
}

export function recordSpeech(s: AgentRuntimeSnapshot, speech: string): AgentRuntimeSnapshot {
  return { ...s, cognition: { ...s.cognition, speech }, timestamp: Date.now() };
}

export function recordAction(s: AgentRuntimeSnapshot, action: string): AgentRuntimeSnapshot {
  return { ...s, behavior: { ...s.behavior, currentAction: action }, timestamp: Date.now() };
}

/** 动画片段一旦被派发到身体（PLAY_ANIMATION），它既是"当前动作片段"，也意味着身体"正在播放" */
export function recordClip(s: AgentRuntimeSnapshot, clip: string): AgentRuntimeSnapshot {
  return {
    ...s,
    behavior: { ...s.behavior, currentClip: clip },
    avatar: { ...s.avatar, animation: clip },
    timestamp: Date.now(),
  };
}

export function recordMood(s: AgentRuntimeSnapshot, mood: string): AgentRuntimeSnapshot {
  return { ...s, avatar: { ...s.avatar, mood }, timestamp: Date.now() };
}

/**
 * 记录当前激活的身体 profile id（来源：AvatarService.activeId）。
 * 纯函数式写入，与 recordClip 等同构；事实在 AvatarService，此处只读镜像。
 */
export function recordAvatarProfile(s: AgentRuntimeSnapshot, id: string): AgentRuntimeSnapshot {
  return { ...s, avatar: { ...s.avatar, activeAvatarId: id }, timestamp: Date.now() };
}

/**
 * 记录当前离散生命阶段（来源：LIFE_PHASE_CHANGED.phase）。
 * 纯函数式写入，与其它 recordX 同构。
 */
export function recordLifePhase(s: AgentRuntimeSnapshot, phase: LifePhase): AgentRuntimeSnapshot {
  return { ...s, life: { phase }, timestamp: Date.now() };
}

/**
 * 记录自主行为调度器状态（来源：AUTONOMOUS_BEHAVIOR_CHANGED.state）。
 * 纯函数式写入，与其它 recordX 同构；仅状态有变化时由调度器广播，绝不轮询。
 */
export function recordAutonomous(
  s: AgentRuntimeSnapshot,
  state: AutonomousSchedulerState,
): AgentRuntimeSnapshot {
  return { ...s, autonomous: state, timestamp: Date.now() };
}

/**
 * 记录当前生效人格（来源：PERSONALITY_PROFILE_CHANGED）。
 * 纯函数式写入，与其它 recordX 同构；仅人格切换时由 life-loop 广播写入，绝不轮询。
 */
export function recordPersonality(
  s: AgentRuntimeSnapshot,
  p: { profileId: PersonalityProfileId | null; traits: PersonalityTraits; tuning: AutonomousBehaviorTuning },
): AgentRuntimeSnapshot {
  return { ...s, personality: p, timestamp: Date.now() };
}

/**
 * 记录当前情绪状态（来源：EMOTION_STATE_CHANGED.state）。
 * 纯函数式写入，与其它 recordX 同构；每 tick 由 life-loop 驱动 EmotionEngine 后广播写入，绝不轮询。
 * 情绪本身不在此发意图——它只反映内部状态，由 life-loop 读取后经人格调制影响行为。
 */
export function recordEmotion(s: AgentRuntimeSnapshot, state: EmotionState): AgentRuntimeSnapshot {
  return { ...s, emotion: state, timestamp: Date.now() };
}
