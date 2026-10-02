// ============================================================
// cognition-engine — 认知引擎 (v0.1.0-alpha)
// ============================================================
// 把"用户输入作为客观事实最先落盘"作为不可动摇的时序契约：
//   1. 用户开口 → 立刻 MEMORY_APPEND(user) → 不等 AI 结果。
//   2. 弹思考占位（前端可据此禁用输入框）。
//   3. 调 LLM → 成功才追加 avatar 记忆 / 广播 speech / mood / 派发意图。
//   4. 失败（空响应/畸形 JSON/网络错）→ 清空气泡，静默释放，绝不抛错污染调用方。
//
// 与设计红线一致：本包纯 TS，不依赖 React/Drei/Vite，不反向依赖 apps/desktop。
// 所有对外副作用都经由 @avatar-os/runtime 的 kernelEventBus / AgentSandbox，
// 与现有"事件总线 + 门禁"架构无缝咬合。
// ============================================================

import { kernelEventBus, AgentSandbox } from "@avatar-os/runtime";
import { Mood, PhysicalIntentType } from "@avatar-os/primitives";
import { LLMProvider, PHYSICAL_INTENT_TYPES } from "./provider";
import { normalizeIntent, isDispatchable } from "./intent-normalizer";

export interface LifeContext {
  /** 用户的原始发言；存在即视为"客观事实"，最先落盘 */
  userInput?: string;
  /** 近期记忆文本，用于给 LLM 喂上下文 */
  recentMemories?: string[];
  /** 当前情绪（来自 EmotionalState） */
  currentMood: Mood;
  /** 能量 0.0~1.0（来自 LifeState） */
  energy: number;
  /** 孤独感 0.0~1.0（来自 LifeState） */
  loneliness: number;
}

/** 情绪白名单（基于 Mood 枚举运行时推导） */
export const VALID_MOODS = new Set<string>(Object.values(Mood));
/** 意图白名单（复用 provider 的单一事实来源） */
export const VALID_INTENTS = new Set<string>(PHYSICAL_INTENT_TYPES as readonly string[]);

/** 外部沙箱契约：只需能派发物理意图即可（方便测试注入 mock） */
export interface SandboxLike {
  dispatchExternalIntent(intent: PhysicalIntentType, intensity?: number): boolean;
}

export class CognitionEngine {
  private isThinking = false;
  private lastTriggerAt = 0;
  private readonly minIntervalMs = 1500;

  constructor(
    private readonly sandbox: SandboxLike = AgentSandbox,
    private readonly provider: LLMProvider,
  ) {}

  public async think(ctx: LifeContext): Promise<void> {
    const now = Date.now();

    // 防重入：思考中直接放弃，避免并发 emit 把总线变成搅拌机
    if (this.isThinking) return;
    // 节流：距上次触发不足阈值且无用户输入时，自发思考让位，杜绝无意义的轮询噪声
    if (now - this.lastTriggerAt < this.minIntervalMs && !ctx.userInput) return;

    this.isThinking = true;
    this.lastTriggerAt = now;

    try {
      // ✅ 核心时序契约：客观事实先行落盘。
      // 只要用户开口，立刻记入记忆总线——AI 崩了，用户的话也不丢。
      if (ctx.userInput) {
        kernelEventBus.emit("MEMORY_APPEND", {
          source: "user",
          content: ctx.userInput,
          timestamp: Date.now(),
        });
      }

      // 思考占位（前端订阅 AVATAR_THOUGHT kind="thinking" 可禁用输入框）
      kernelEventBus.emit("AVATAR_THOUGHT", {
        emoji: "🤔",
        text: "让我想想...",
        kind: "thinking",
      });

      const systemPrompt = this.buildSystemPrompt(ctx);
      const userPrompt = ctx.userInput
        ? `用户说："${ctx.userInput}"`
        : "根据当前状态，自发说一句符合你性格的话。";

      const result = await this.provider.generate(userPrompt, systemPrompt);

      if (!result.ok) {
        // 收到非法/空响应：清空气泡，静默释放控制权，绝不二次抛错
        kernelEventBus.emit("AVATAR_THOUGHT", { kind: "clear" });
        return;
      }

      // 只有成功响应，才追加 AI 的回复到记忆
      const safeSpeech = (result.speech ?? "").slice(0, 80);
      if (safeSpeech) {
        kernelEventBus.emit("AVATAR_THOUGHT", { emoji: "💬", text: safeSpeech, kind: "speech" });
        kernelEventBus.emit("MEMORY_APPEND", {
          source: "avatar",
          content: safeSpeech,
          timestamp: Date.now(),
        });
      }

      if (result.mood && VALID_MOODS.has(result.mood) && result.mood !== ctx.currentMood) {
        kernelEventBus.emit("STATE_MOOD_CHANGED", { mood: result.mood });
      }

      // —— 意图归一化（观察优先，不拦截）——
      // provider 透传的是 LLM 原始意图字符串；这里归一化后：
      //   · 合法物理意图 → 经 AgentSandbox 派发（IntentSource="AI"），交 Arbiter 仲裁
      //   · NONE（模型明确无动作）→ 不派发，但原始证据已随 INTENT_NORMALIZED 进日志
      //   · UNKNOWN（系统不认识）→ 同上，且 raw 保留供未来 Intent Router 训练
      const norm = normalizeIntent(result.intent);
      kernelEventBus.emit("INTENT_NORMALIZED", {
        raw: norm.raw,
        normalized: norm.normalized,
        matched: norm.matched,
      });
      if (isDispatchable(norm.normalized)) {
        this.sandbox.dispatchExternalIntent(norm.normalized, 0.8);
      }
    } finally {
      this.isThinking = false;
    }
  }

  private buildSystemPrompt(ctx: LifeContext): string {
    const memoryLine = (ctx.recentMemories ?? [])
      .slice(-5)
      .map((m) => `- ${m}`)
      .join("\n");
    return [
      "你是桌面上一个名叫「二狗子」的萌系桌面宠物，性格接地气、话不多但到位。",
      "请用简体中文回复，不超过 80 字。",
      "只输出一个 JSON 对象，不要任何解释或额外文字，格式如下：",
      '{"intent":"GREET","speech":"你说的话","mood":"CALM"}',
      "intent 字段只能取【单个】值，从以下 7 个里选一个（不要并列、不要抄示例格式）：",
      "GREET / PEEK / STRETCH / BOUNCE_HAPPY / LOOK_AT_USER / DOZE / IDLE_BREATHE。",
      "没有明确肢体动作意图时【省略】该字段（不要填 none 或空字符串）。",
      `当前情绪：${ctx.currentMood}，能量：${ctx.energy.toFixed(2)}，孤独感：${ctx.loneliness.toFixed(2)}`,
      memoryLine ? `近期记忆：\n${memoryLine}` : "近期记忆：无",
    ].join("\n");
  }
}
