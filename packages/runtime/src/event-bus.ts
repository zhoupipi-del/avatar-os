import { Mood, PhysicalIntent } from "@avatar-os/primitives";

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
  | "MEMORY_APPEND"
  | "SPEECH_INPUT";

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
