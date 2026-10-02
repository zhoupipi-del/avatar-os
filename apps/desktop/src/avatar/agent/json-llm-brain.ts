import type {
  AgentBrain,
  AgentBrainInput,
  AgentBrainOutput,
} from "./agent-intent";
import { parseBrainJsonOutput, extractFirstJsonObject } from "./brain-json-parser";
import type { LlmProvider } from "./llm-provider";
import { RuleBasedBrain } from "./rule-based-brain";

/** 系统提示词：强制只输出 JSON，字段与 AgentBrainOutput 对齐 */
export const JSON_LLM_SYSTEM_PROMPT = `你是一个桌面 AI 伙伴 VOID。请只用严格的 JSON 对象回复，不要输出任何 JSON 以外的文字或代码围栏。
JSON 字段：
- speech: string，用简短中文回复（不超过 40 字）
- intent: { "type": "GREET" | "SAD_BODY" | "THINKING" | "PEEK" | "BOUNCE_HAPPY" | "HAPPY_IDLE" | "IDLE" | "NONE" | "LISTEN" | "COMFORT" | "GREET_ALT", "intensity": number 0~1 }
- emotion: { "type": "neutral" | "happy" | "sad" | "thinking" | "curious" | "tired", "intensity": number 0~1 }
只输出一个 JSON 对象。`;

/** 回复文本最大长度（超出截断，防止模型啰嗦撑爆气泡） */
export const MAX_SPEECH_LENGTH = 80;

export interface JsonLlmBrainOptions {
  /** 自定义系统提示词（默认 JSON_LLM_SYSTEM_PROMPT） */
  readonly systemPrompt?: string;
  /** 回复文本最大长度（默认 MAX_SPEECH_LENGTH） */
  readonly maxSpeechLength?: number;
  /** 回退脑（默认 RuleBasedBrain） */
  readonly fallback?: AgentBrain;
}

/**
 * JsonLlmBrain —— 真实 LLM 演示脑（Day2）
 *
 * 向 LLM 要求只输出 JSON，复用 brain-json-parser 解析；
 * JSON 解析失败 / LLM 不可用时，自动回退 RuleBasedBrain。
 * 不抛错：对外永远返回合法的 AgentBrainOutput。
 */
export class JsonLlmBrain implements AgentBrain {
  private readonly provider: LlmProvider;
  private readonly fallback: AgentBrain;
  private readonly systemPrompt: string;
  private readonly maxSpeechLength: number;

  constructor(provider: LlmProvider, options: JsonLlmBrainOptions = {}) {
    this.provider = provider;
    this.fallback = options.fallback ?? new RuleBasedBrain();
    this.systemPrompt = options.systemPrompt ?? JSON_LLM_SYSTEM_PROMPT;
    this.maxSpeechLength = options.maxSpeechLength ?? MAX_SPEECH_LENGTH;
  }

  async think(input: AgentBrainInput): Promise<AgentBrainOutput> {
    try {
      const raw = await this.provider.complete(this.systemPrompt, input.text);

      // JSON 解析失败（无对象 / 语法损坏）→ 回退规则脑
      const json = extractFirstJsonObject(raw);
      if (!json) {
        return this.fallback.think(input);
      }
      try {
        JSON.parse(json);
      } catch {
        return this.fallback.think(input);
      }

      const parsed = parseBrainJsonOutput(raw, {
        fallbackSpeech: "我在听。",
      });

      return {
        ...parsed,
        speech: clampSpeech(parsed.speech, this.maxSpeechLength),
      };
    } catch {
      // LLM 不可用 / 请求抛错 → 回退规则脑
      return this.fallback.think(input);
    }
  }
}

function clampSpeech(speech: string, maxLength: number): string {
  if (speech.length <= maxLength) {
    return speech;
  }
  return speech.slice(0, maxLength);
}
