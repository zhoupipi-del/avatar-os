// ============================================================
// thoughts — 状态/想法气泡 翻译层 (v0.1.0-alpha)
// ============================================================
// 把内核的"情绪 / 物理意图 / 系统状态"翻译为统一的想法气泡内容，
// 经 AVATAR_THOUGHT 事件广播，驱动渲染层的 ThoughtBubble 组件。
//
// 设计要点：
//   - 纯映射函数(moodThought/intentThought/systemThought)无副作用、可单测。
//   - initThoughtRelay() 一次性订阅三条内核事件，仅在"状态真正切换"时冒泡，
//     避免 CALM→CALM、INTENT 高频刷新导致的气泡刷屏。
//   - 空闲行为树的想法气泡由 Avatar 直接发射(source="IDLE")，不经此处，
//     避免与情绪总线重复冒泡。

import { Mood, PhysicalIntentType } from "@avatar-os/primitives";
import { kernelEventBus } from "./event-bus";

export interface ThoughtContent {
  emoji: string;
  text: string;
}

/** 情绪 → 想法气泡（CALM 静息态不冒泡，避免刷屏） */
export function moodThought(m: Mood): ThoughtContent | null {
  switch (m) {
    case Mood.CURIOUS:
      return { emoji: "🤔", text: "咦，有意思~" };
    case Mood.HAPPY:
      return { emoji: "😊", text: "好开心呀！" };
    case Mood.PLAYFUL:
      return { emoji: "😜", text: "嘿嘿~" };
    case Mood.EXCITED:
      return { emoji: "🤩", text: "哇！" };
    case Mood.SLEEPING:
      return { emoji: "😴", text: "困了…" };
    case Mood.TIRED:
      return { emoji: "😮‍💨", text: "有点累…" };
    case Mood.LONELY:
      return { emoji: "🥺", text: "想你了…" };
    case Mood.SAD:
      return { emoji: "😢", text: "呜…" };
    case Mood.FOCUSED:
      return { emoji: "🧐", text: "认真中…" };
    default:
      return null; // CALM 等静息态不冒泡
  }
}

/** 物理意图 → 情绪反馈气泡（仅"带情绪"的高阶意图，纯动作意图不冒泡） */
export function intentThought(t: PhysicalIntentType): ThoughtContent | null {
  switch (t) {
    case "GREET":
      return { emoji: "👋", text: "嗨！" };
    case "BOUNCE_HAPPY":
      return { emoji: "😆", text: "哈哈！" };
    case "PEEK":
      return { emoji: "👀", text: "偷偷看…" };
    case "DOZE":
      return { emoji: "😴", text: "瞌睡了…" };
    default:
      return null; // IDLE_BREATHE / LOOK_AT_USER / STRETCH 等纯动作不冒泡
  }
}

/** 系统状态 → 状态播报气泡 */
export function systemThought(status: "idle" | "success" | "error"): ThoughtContent | null {
  switch (status) {
    case "success":
      return { emoji: "🎉", text: "搞定啦！" };
    case "error":
      return { emoji: "😣", text: "出错了…" };
    default:
      return null;
  }
}

let relayBound = false;
let lastMood: string | null = null;

/**
 * 启动想法气泡中继：订阅内核事件 → 发射 AVATAR_THOUGHT。
 * 幂等：多次调用只绑定一次；返回的解绑函数可安全重复调用。
 */
export function initThoughtRelay(): () => void {
  if (relayBound) return () => {};
  relayBound = true;

  const emit = (c: ThoughtContent | null, kind: "thought" | "state", source: string): void => {
    if (!c) return;
    kernelEventBus.emit("AVATAR_THOUGHT", { emoji: c.emoji, text: c.text, kind, source });
  };

  const u1 = kernelEventBus.on("STATE_MOOD_CHANGED", (p) => {
    // 仅在情绪真正切换时冒泡（CALM→CALM 不刷屏）
    if (p.mood === lastMood) return;
    lastMood = p.mood;
    emit(moodThought(p.mood), "state", "MOOD");
  });

  const u2 = kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (intent) => {
    emit(intentThought(intent.type), "thought", "INTENT");
  });

  const u3 = kernelEventBus.on("SYSTEM_STATUS_CHANGED", (p) => {
    emit(systemThought(p.status), "state", "SYSTEM");
  });

  return () => {
    u1();
    u2();
    u3();
    relayBound = false;
  };
}
