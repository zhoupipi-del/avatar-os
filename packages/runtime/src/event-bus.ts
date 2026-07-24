import { Mood, PhysicalIntent } from "@avatar-os/primitives";
import type { LifePhase } from "./life/life-phase";
import type { AutonomousSchedulerState } from "./life/autonomous-scheduler";
import type { PersonalityTraits, PersonalityProfileId, AutonomousBehaviorTuning } from "./personality/behavior-tuning";
import type { EmotionState } from "./emotion/emotion-state";

export type KernelEventType =
  | "SENSOR_MOUSE_MOVE"
  | "SENSOR_MOUSE_NEAR"
  | "SENSOR_MOUSE_FAR"
  | "DRIVE_PRESSURE_TICK"
  | "PHYSICAL_INTENT_DISPATCH"
  | "STATE_MOOD_CHANGED"
  | "STATE_MOTION_CHANGED"
  | "STATE_RENDER_PARAMS_CHANGED"
  | "SYSTEM_STATUS_CHANGED"
  | "AVATAR_THOUGHT"
  | "INTENT_NORMALIZED"
  | "MEMORY_APPEND"
  | "SPEECH_INPUT"
  | "AVATAR_PRIMITIVE"
  | "LIFE_PHASE_CHANGED"
  | "AUTONOMOUS_BEHAVIOR_CHANGED"
  | "ANIMATION_CLIP_STATE"
  | "PERSONALITY_PROFILE_REQUEST"
  | "PERSONALITY_PROFILE_CHANGED"
  | "EMOTION_STATE_CHANGED";

export interface KernelEventPayloads {
  SENSOR_MOUSE_MOVE: { x: number; y: number };
  SENSOR_MOUSE_NEAR: { distance: number };
  SENSOR_MOUSE_FAR: void;
  DRIVE_PRESSURE_TICK: { timestamp: number };
  PHYSICAL_INTENT_DISPATCH: PhysicalIntent;
  STATE_MOOD_CHANGED: { mood: Mood };
  STATE_MOTION_CHANGED: { motion: string };
  STATE_RENDER_PARAMS_CHANGED: {
    eyeOpenRatio: number;
    bodyScale: number;
    gazeBias: { x: number; y: number };
  };
  SYSTEM_STATUS_CHANGED: { status: "idle" | "success" | "error" };
  /**
   * 状态/想法气泡：由情绪/意图/系统状态/空闲行为树/Cognition 引擎统一发射，驱动 ThoughtBubble 渲染。
   * kind 扩展：thought/state(原有) + speech(LLM 说出) / thinking(LLM 思考占位) / clear(清空气泡)。
   * emoji/text 在 clear 时可省略（clear 仅用于清空，不渲染内容）。
   */
  /**
   * 意图归一化追踪（v0.3-M1）：CognitionEngine 调 LLM 后，把原始意图字符串与
   * 归一化结果广播出来。DebugConsole 据此打印 raw → normalized，让"LLM 到底吐了啥"
   * 永远可观测；UNKNOWN 的原始证据也借此留存，供未来 Intent Router 训练。
   * normalized 用 string 而非 NormalizedIntent，避免 runtime 反向依赖 cognition 包（红线）。
   */
  INTENT_NORMALIZED: { raw: string; normalized: string; matched: boolean };
  AVATAR_THOUGHT: {
    emoji?: string;
    text?: string;
    kind: "thought" | "state" | "speech" | "thinking" | "clear";
    /** 自动淡出时长(ms)，缺省由组件决定；kind="thinking" 不自动淡出，等待 clear/speech 覆盖 */
    durationMs?: number;
    /** 来源标记: MOOD / INTENT / SYSTEM / IDLE / COGNITION */
    source?: string;
  };
  /** 记忆追加：Cognition 引擎将用户发言 / AI 回复落盘到 MemoryKernel 的总线事件 */
  MEMORY_APPEND: {
    source: "user" | "avatar" | "system";
    content: string;
    timestamp: number;
  };
  /** 用户输入：Tauri Chat Input 或语音转写注入的用户的原始发言，供 Cognition 引擎消费 */
  SPEECH_INPUT: {
    text: string;
    timestamp: number;
  };
  /**
   * 具身执行追踪：BehaviorVMAdapter 每派发一条 PrimitiveCommand 即广播，
   * 供 Debug Console 把"INTENT → POSE/ANIMATION"这一段链路完整呈现。
   * detail 根据 type 携带 clip / text / angle 等，便于肉眼核对动画是否真的播放。
   */
  AVATAR_PRIMITIVE: {
    type: string;
    detail: string;
  };
  /** 离散生命阶段变化（v0.3.5-A）。去重后仅阶段真变化时广播。 */
  LIFE_PHASE_CHANGED: { phase: LifePhase };
  /** 自主行为调度器状态变化（v0.3.6-A）：仅状态有变化时广播，供 Runtime Snapshot / DebugConsole 观测。 */
  AUTONOMOUS_BEHAVIOR_CHANGED: { state: AutonomousSchedulerState };
  /** 显式动画片段播放状态（v0.3.6-A）：由 AnimationManager.playOnce 生命周期驱动，
   *  供调度器得知"身体正忙"从而不插入自主动作。idle 循环片段(play)不广播此事件。 */
  ANIMATION_CLIP_STATE: { playing: boolean; clip: string };
  /**
   * 人格切换请求（v0.3.6-B）：唯一对外入口，由 DebugConsole dev-only 切换器发出。
   * life-loop 订阅后转交调度器，再广播 CHANGED——保证调度器不被任何 UI 直接触碰。
   */
  PERSONALITY_PROFILE_REQUEST: { traits: PersonalityTraits };
  /**
   * 人格已生效（v0.3.6-B）：life-loop 套用调音后广播，供 Runtime Snapshot / DebugConsole 观测。
   * profileId 为匹配到的内置 Profile id，自定 traits 时为 null。
   */
  PERSONALITY_PROFILE_CHANGED: { profileId: PersonalityProfileId | null; traits: PersonalityTraits; tuning: AutonomousBehaviorTuning };
  /**
   * 情绪状态变化（v0.3.6-C）：life-loop 每 tick 驱动 EmotionEngine 后广播，
   * 供 Runtime Snapshot / DebugConsole 观测。情绪本身永不发意图——它只改变内部状态，
   * 由 life-loop 读取后经 applyEmotionToTraits → 调度器那条既有发射口影响行为。
   */
  EMOTION_STATE_CHANGED: { state: EmotionState };
}

type EventCallback<T> = (payload: T) => void;

export class TypedEventBus {
  private listeners: { [K in KernelEventType]?: EventCallback<any>[] } = {};

  public on<K extends KernelEventType>(type: K, cb: EventCallback<KernelEventPayloads[K]>): () => void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type]!.push(cb);
    return () => this.off(type, cb);
  }

  public off<K extends KernelEventType>(type: K, cb: EventCallback<KernelEventPayloads[K]>): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type]!.filter((fn) => fn !== cb);
  }

  public emit<K extends KernelEventType>(type: K, payload?: KernelEventPayloads[K]): void {
    this.listeners[type]?.forEach((fn) => fn(payload));
  }
}

export const kernelEventBus = new TypedEventBus();

// ⚠️ TEMPORARY COMPAT SHIM — 冻结期 Avatar.tsx 与遗留消费者仍引用 `eventBus`。
// 它与 kernelEventBus 是【同一实例】，保证事件流不断。
// Day 7 将 Avatar.tsx 重构为纯 PHYSICAL_INTENT_DISPATCH 渲染后，本段连同旧订阅一并删除。
export const eventBus = kernelEventBus as unknown as {
  on(type: string, cb: (p: any) => void): () => void;
  off(type: string, cb: (p: any) => void): void;
  emit(type: string, payload?: any): void;
};
