import type { AgentBrain } from "./agent-intent";
import { RuleBasedBrain } from "./rule-based-brain";
import { OllamaProvider } from "./ollama-provider";
import { JsonLlmBrain } from "./json-llm-brain";

export interface CreateDefaultDemoBrainOptions {
  /** Ollama 服务地址 */
  readonly ollamaBaseUrl?: string;
  /** Ollama 模型名 */
  readonly ollamaModel?: string;
  /** 显式强制使用规则脑（覆盖环境变量） */
  readonly forceRule?: boolean;
  /** 可注入的 fetch 实现（测试用） */
  readonly fetchImpl?: typeof fetch;
}

/**
 * createDefaultDemoBrain —— Day2 大脑工厂
 *
 * - 环境变量 VITE_AVATAROS_BRAIN_MODE=rule 时强制规则脑
 * - 默认优先 Ollama（qwen2.5:7b），任何失败自动回退 RuleBasedBrain
 *
 * 不接 OpenAI / TTS / LipSync / Memory / Relationship。
 */
export function createDefaultDemoBrain(
  options: CreateDefaultDemoBrainOptions = {},
): AgentBrain {
  const forceRule =
    options.forceRule ??
    import.meta.env?.VITE_AVATAROS_BRAIN_MODE === "rule";

  if (forceRule) {
    return new RuleBasedBrain();
  }

  const provider = new OllamaProvider({
    baseUrl: options.ollamaBaseUrl,
    model: options.ollamaModel,
    fetchImpl: options.fetchImpl,
  });

  return new JsonLlmBrain(provider, {
    fallback: new RuleBasedBrain(),
  });
}
