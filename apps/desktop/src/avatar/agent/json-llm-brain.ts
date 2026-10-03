import type {
  AgentBrain,
  AgentBrainInput,
  AgentBrainOutput,
} from "./agent-intent";
import { parseBrainJsonOutput, extractFirstJsonObject } from "./brain-json-parser";
import type { LlmMessage, LlmProvider } from "./llm-provider";
import type { ConversationMemory } from "./conversation-memory";
import { RuleBasedBrain } from "./rule-based-brain";

/** 系统提示词：强制只输出 JSON，字段与 AgentBrainOutput 对齐 */
export const JSON_LLM_SYSTEM_PROMPT = `你是一个桌面 AI 伙伴 VOID。请只用严格的 JSON 对象回复，不要输出任何 JSON 以外的文字或代码围栏。
JSON 字段：
- speech: string，用简短中文回复（不超过 40 字）
- intent: { "type": "GREET" | "SAD_BODY" | "THINKING" | "PEEK" | "BOUNCE_HAPPY" | "HAPPY_IDLE" | "IDLE" | "NONE" | "LISTEN" | "COMFORT" | "GREET_ALT", "intensity": number 0~1 }
- emotion: { "type": "neutral" | "happy" | "sad" | "thinking" | "curious" | "tired", "intensity": number 0~1 }
只输出一个 JSON 对象。
如果之前有对话，请结合上下文自然地接话，记住对方说过的事。`;

/** 回复文本最大长度（超出截断，防止模型啰嗦撑爆气泡） */
export const MAX_SPEECH_LENGTH = 80;

export interface JsonLlmBrainOptions {
  /** 自定义系统提示词（默认 JSON_LLM_SYSTEM_PROMPT）；传函数则每次对话现算（人设 / 当前时间） */
  readonly systemPrompt?: string | (() => string);
  /** 回复文本最大长度（默认 MAX_SPEECH_LENGTH） */
  readonly maxSpeechLength?: number;
  /** 回退脑（默认 RuleBasedBrain） */
  readonly fallback?: AgentBrain;
  /** 多轮对话记忆（可选；提供时把最近对话作为上下文发给 LLM，并记录本轮） */
  readonly memory?: ConversationMemory;
}

/**
 * 大脑真实状态（供启动自检条 Brain 灯使用，不伪造）：
 *  - unknown：尚未探测 / 尚未对话
 *  - llm：最近一次由 LLM 正常产出
 *  - fallback：LLM 不可达或输出无法解析，已回退规则脑
 */
export type BrainSource = "unknown" | "llm" | "fallback";

export interface BrainStatus {
  readonly source: BrainSource;
  readonly provider: string;
  readonly lastError: string | null;
  readonly updatedAt: number | null;
}

export interface StatusReportingBrain extends AgentBrain {
  getStatus(): BrainStatus;
  /** 主动探测 LLM 可达性（启动时调用一次即可） */
  probe(): Promise<BrainStatus>;
}

/**
 * JsonLlmBrain —— 真实 LLM 演示脑（Day2）
 *
 * 向 LLM 要求只输出 JSON，复用 brain-json-parser 解析；
 * JSON 解析失败 / LLM 不可用时，自动回退 RuleBasedBrain。
 * 不抛错：对外永远返回合法的 AgentBrainOutput。
 */
export class JsonLlmBrain implements StatusReportingBrain {
  private readonly provider: LlmProvider;
  private readonly fallback: AgentBrain;
  private readonly systemPrompt: string | (() => string);
  private readonly maxSpeechLength: number;
  private readonly memory: ConversationMemory | null;
  private status: BrainStatus;

  constructor(provider: LlmProvider, options: JsonLlmBrainOptions = {}) {
    this.provider = provider;
    this.fallback = options.fallback ?? new RuleBasedBrain();
    this.systemPrompt = options.systemPrompt ?? JSON_LLM_SYSTEM_PROMPT;
    this.maxSpeechLength = options.maxSpeechLength ?? MAX_SPEECH_LENGTH;
    this.memory = options.memory ?? null;
    this.status = { source: "unknown", provider: provider.name, lastError: null, updatedAt: null };
  }

  getStatus(): BrainStatus {
    return this.status;
  }

  async probe(): Promise<BrainStatus> {
    let ok = false;
    try {
      ok = await this.provider.isAvailable();
    } catch {
      ok = false;
    }
    // 已有真实对话结果时，以对话结果为准；探测只填补 unknown
    if (this.status.source === "unknown" || !ok) {
      const providerError = (this.provider as { getLastError?: () => string | null }).getLastError?.();
      this.setStatus(ok ? "llm" : "fallback", ok ? null : providerError ?? `${this.provider.name} 不可达`);
    }
    return this.status;
  }

  async think(input: AgentBrainInput): Promise<AgentBrainOutput> {
    const output = await this.thinkInner(input);
    if (this.memory && input.text.trim()) {
      this.memory.append("user", input.text, input.now);
      this.memory.append("assistant", output.speech);
    }
    return output;
  }

  private async thinkInner(input: AgentBrainInput): Promise<AgentBrainOutput> {
    try {
      const systemPrompt =
        typeof this.systemPrompt === "function" ? this.systemPrompt() : this.systemPrompt;
      const raw = await this.provider.complete(
        systemPrompt,
        input.text,
        this.buildHistory(),
      );

      // JSON 解析失败（无对象 / 语法损坏）→ 回退规则脑
      const json = extractFirstJsonObject(raw);
      if (!json) {
        this.setStatus("fallback", "LLM 输出不含 JSON");
        return this.fallback.think(input);
      }
      try {
        JSON.parse(json);
      } catch {
        this.setStatus("fallback", "LLM 输出 JSON 语法错误");
        return this.fallback.think(input);
      }

      const parsed = parseBrainJsonOutput(raw, {
        fallbackSpeech: "我在听。",
      });

      this.setStatus("llm", null);
      return {
        ...parsed,
        speech: clampSpeech(parsed.speech, this.maxSpeechLength),
      };
    } catch (error) {
      // LLM 不可用 / 请求抛错 → 回退规则脑
      const providerError = (this.provider as { getLastError?: () => string | null }).getLastError?.();
      this.setStatus("fallback", providerError ?? (error instanceof Error ? error.message : String(error)));
      return this.fallback.think(input);
    }
  }

  /**
   * 把记忆转成 LLM 消息。assistant 历史用与输出一致的 JSON 形状包装，
   * 避免小模型看到纯文本历史后"学坏"、不再输出 JSON。
   */
  private buildHistory(): LlmMessage[] {
    if (!this.memory) return [];
    return this.memory.recent().map((turn) =>
      turn.role === "user"
        ? { role: "user", content: turn.text }
        : { role: "assistant", content: JSON.stringify({ speech: turn.text }) },
    );
  }

  private setStatus(source: BrainSource, lastError: string | null): void {
    this.status = { source, provider: this.provider.name, lastError, updatedAt: Date.now() };
  }
}

export function isStatusReportingBrain(brain: AgentBrain): brain is StatusReportingBrain {
  return typeof (brain as Partial<StatusReportingBrain>).getStatus === "function" &&
    typeof (brain as Partial<StatusReportingBrain>).probe === "function";
}

function clampSpeech(speech: string, maxLength: number): string {
  if (speech.length <= maxLength) {
    return speech;
  }
  return speech.slice(0, maxLength);
}
