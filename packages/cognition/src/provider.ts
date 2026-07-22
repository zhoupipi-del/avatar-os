// ============================================================
// provider — LLM 提供者抽象 + Ollama 本地实现 (v0.1.0-alpha)
// ============================================================
// Cognition 引擎不直接耦合任何具体 LLM，只依赖 LLMProvider 契约。
// 默认实现走本地 Ollama（localhost:11434），零成本、零隐私外泄，
// 与 BOSS 本机已装好的 deepseek-r1:8b / qwen2.5:14b 直接对接。
//
// 关键防护：Ollama deepseek-r1 的真实输出常带 <think> 思维链 +
// markdown ```json 代码块包裹。extractStructured 必须逐层剥离，
// 否则脏数据会穿透到内核，制造"虚假安全感"式的偶发崩溃。
// ============================================================

import { Mood } from "@avatar-os/primitives";

export interface LLMResult {
  /** 是否解析出至少一个可用的 speech（决定本次响应是否"成功"） */
  ok: boolean;
  speech?: string;
  mood?: Mood;
  /**
   * LLM 原始意图字符串（未校验、未归一化）。
   * ⚠️ 只透传，绝不预校验/丢弃——归一化推迟到 CognitionEngine 的 IntentNormalizer。
   * 这是"观察优先"的前提：未知意图→UNKNOWN（保留 raw），而不是被 provider 静默变成 undefined。
   */
  intent?: string;
}

export interface LLMProvider {
  generate(userPrompt: string, systemPrompt: string): Promise<LLMResult>;
}

/**
 * 物理意图合法值清单。
 * PhysicalIntentType 是字符串联合类型，没有运行时枚举对象可用，
 * 这里单列一份作为校验的单一事实来源（engine 也复用它构建 VALID_INTENTS）。
 */
export const PHYSICAL_INTENT_TYPES = [
  "IDLE_BREATHE",
  "LOOK_AT_USER",
  "DOZE",
  "STRETCH",
  "GREET",
  "PEEK",
  "BOUNCE_HAPPY",
] as const;

function isMood(v: unknown): v is Mood {
  // Mood 是 TS enum，运行时即 { CALM:"CALM", ... } 对象
  return typeof v === "string" && v in Mood;
}

/**
 * 从 LLM 原始文本中提取结构化指令。
 * 层层降级：剥离 <think> → 提取 ```json 代码块 → 直接 JSON.parse → 截取首尾大括号。
 * 任何一层失败都不抛错，返回 {} 让上层走"无效响应"分支（静默释放控制权）。
 */
export function extractStructured(
  content: string,
): Partial<{ intent: string; speech: string; mood: string }> {
  if (!content) return {};
  try {
    // 1. 剥离 <think>...</think> 思维链（可能多段）
    let s = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
    // 2. 提取 markdown 代码块（优先 ```json，其次裸 ```）
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1];
    s = s.trim();
    // 3. 直接解析
    try {
      return JSON.parse(s) as Record<string, string>;
    } catch {
      /* 继续尝试退化解析 */
    }
    // 4. 截取首个 { 到最后一个 }，应对"前后有废话"的脏输出
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(s.slice(start, end + 1)) as Record<string, string>;
    }
  } catch {
    /* 放弃，返回 {} */
  }
  return {};
}

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly model = "deepseek-r1:8b",
    private readonly baseUrl = "http://localhost:11434",
  ) {}

  async generate(userPrompt: string, systemPrompt: string): Promise<LLMResult> {
    const prompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;

    let data: unknown;
    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt, stream: false }),
      });
      if (!res.ok) {
        console.debug(`[OllamaProvider 🛡️] HTTP ${res.status}，已静默释放控制权`);
        return { ok: false };
      }
      data = await res.json();
    } catch (err) {
      console.debug("[OllamaProvider 🛡️] 请求失败（Ollama 未启动？），已静默释放控制权:", err);
      return { ok: false };
    }

    // ⚠️ 关键：/api/generate 的返回体里文本在 `response` 字段（string），
    // 而 /api/chat 才是 `message.content`。这里两个都兼容，避免读错字段导致永远拿不到文本
    // （曾因此误判为"模型弱/空响应降级"，实则 provider 取错字段）。
    const d = data as { response?: string; message?: { content?: string } };
    const content = d.response ?? d.message?.content ?? "";
    const parsed = extractStructured(content);

    const mood = isMood(parsed.mood) ? parsed.mood : undefined;
    // ⚠️ 透传原始意图字符串，不做预校验/丢弃。归一化推迟到 CognitionEngine 的
    // IntentNormalizer（观察优先：保留 raw 证据，未知→UNKNOWN 而非静默 undefined）。
    const intent = parsed.intent != null ? String(parsed.intent) : undefined;
    const speech = typeof parsed.speech === "string" ? parsed.speech : undefined;

    // 至少要有可说的内容才算成功响应；否则视为无效，让引擎走 fallback
    if (!speech) return { ok: false };
    return { ok: true, speech, mood, intent };
  }
}
