/**
 * CompanionBrain —— 按「陪伴设置」实时切换的大脑
 *
 * 设置里换厂商 / 换 Key / 改人设，不需要重启或重建 3D 引擎：
 * 每次对话按当前设置取（或复用缓存的）底层大脑；人设与时间在每次对话时现算进系统提示词。
 */
import type { AgentBrain, AgentBrainInput, AgentBrainOutput } from "../avatar/agent/agent-intent";
import { JsonLlmBrain, type BrainStatus, type StatusReportingBrain } from "../avatar/agent/json-llm-brain";
import { OllamaProvider } from "../avatar/agent/ollama-provider";
import { OpenAICompatibleProvider } from "../avatar/agent/openai-compatible-provider";
import { RuleBasedBrain } from "../avatar/agent/rule-based-brain";
import type { ConversationMemory } from "../avatar/agent/conversation-memory";
import type { LlmProvider } from "../avatar/agent/llm-provider";
import {
  CLOUD_PRESETS,
  cloudPresetLabel,
  type CompanionSettings,
  type CompanionSettingsStore,
} from "./companion-settings";
import { buildChatSystemPrompt } from "./persona";

export interface CompanionBrainOptions {
  readonly store: CompanionSettingsStore;
  readonly memory?: ConversationMemory;
  readonly fetchImpl?: typeof fetch;
  /** 测试注入：自定义系统提示词构造 */
  readonly buildSystemPrompt?: (s: CompanionSettings) => string;
}

/** 根据设置构造底层 LLM Provider（rule 模式返回 null） */
export function createProviderFromSettings(s: CompanionSettings, fetchImpl?: typeof fetch): LlmProvider | null {
  if (s.brainMode === "cloud") {
    const preset = CLOUD_PRESETS[s.cloudPreset];
    return new OpenAICompatibleProvider({
      baseUrl: s.cloudBaseUrl,
      apiKey: s.cloudApiKey,
      model: s.cloudModel,
      label: cloudPresetLabel(s),
      jsonMode: preset?.jsonMode ?? false,
      fetchImpl,
    });
  }
  if (s.brainMode === "ollama") {
    return new OllamaProvider({ baseUrl: s.ollamaEndpoint, model: s.ollamaModel, fetchImpl });
  }
  return null;
}

function providerKey(s: CompanionSettings): string {
  return s.brainMode === "cloud"
    ? JSON.stringify(["cloud", s.cloudPreset, s.cloudBaseUrl, s.cloudModel, s.cloudApiKey])
    : s.brainMode === "ollama"
      ? JSON.stringify(["ollama", s.ollamaEndpoint, s.ollamaModel])
      : "rule";
}

const RULE_STATUS: BrainStatus = {
  source: "fallback",
  provider: "离线规则",
  lastError: "当前为离线规则模式（未连接大模型）",
  updatedAt: null,
};

export class CompanionBrain implements StatusReportingBrain {
  private readonly rule = new RuleBasedBrain();
  private cache: { key: string; brain: JsonLlmBrain | null } | null = null;

  constructor(private readonly options: CompanionBrainOptions) {}

  async think(input: AgentBrainInput): Promise<AgentBrainOutput> {
    input.signal?.throwIfAborted();
    const brain = this.current();
    if (brain) return brain.think(input);
    const out = await this.rule.think(input);
    input.signal?.throwIfAborted();
    if (this.options.memory && input.text.trim()) {
      this.options.memory.append("user", input.text, input.now);
      this.options.memory.append("assistant", out.speech);
    }
    return out;
  }

  getStatus(): BrainStatus {
    return this.current()?.getStatus() ?? RULE_STATUS;
  }

  async probe(): Promise<BrainStatus> {
    const brain = this.current();
    return brain ? brain.probe() : RULE_STATUS;
  }

  /** 设置变化后立即重新探测（设置界面"测试连接"也用它） */
  async reprobe(): Promise<BrainStatus> {
    this.cache = null;
    return this.probe();
  }

  private current(): JsonLlmBrain | null {
    const s = this.options.store.get();
    const key = providerKey(s);
    if (this.cache?.key === key) return this.cache.brain;
    const provider = createProviderFromSettings(s, this.options.fetchImpl);
    const build = this.options.buildSystemPrompt ?? ((x: CompanionSettings) => buildChatSystemPrompt(x));
    const brain = provider
      ? new JsonLlmBrain(provider, {
          fallback: this.rule as AgentBrain,
          memory: this.options.memory,
          systemPrompt: () => build(this.options.store.get()),
          maxSpeechLength: 120,
        })
      : null;
    this.cache = { key, brain };
    return brain;
  }
}
