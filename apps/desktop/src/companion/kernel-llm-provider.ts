/**
 * 主动陪伴（RuntimeKernel → CognitionEngine）用的 LLMProvider：按陪伴设置走云端 / Ollama / 不说话。
 */
import { OllamaProvider as KernelOllamaProvider, extractStructured, type LLMProvider, type LLMResult } from "@avatar-os/cognition";
import { Mood } from "@avatar-os/primitives";
import { OpenAICompatibleProvider } from "../avatar/agent/openai-compatible-provider";
import { CLOUD_PRESETS, cloudPresetLabel, type CompanionSettingsStore } from "./companion-settings";

export class CompanionKernelProvider implements LLMProvider {
  constructor(
    private readonly store: CompanionSettingsStore,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async generate(userPrompt: string, systemPrompt: string): Promise<LLMResult> {
    const s = this.store.get();
    if (s.brainMode === "ollama") {
      return new KernelOllamaProvider(s.ollamaModel, s.ollamaEndpoint.replace(/\/+$/, ""), this.fetchImpl).generate(
        userPrompt,
        systemPrompt,
      );
    }
    if (s.brainMode !== "cloud") return { ok: false };

    const provider = new OpenAICompatibleProvider({
      baseUrl: s.cloudBaseUrl,
      apiKey: s.cloudApiKey,
      model: s.cloudModel,
      label: cloudPresetLabel(s),
      jsonMode: CLOUD_PRESETS[s.cloudPreset]?.jsonMode ?? false,
      maxTokens: 200,
      fetchImpl: this.fetchImpl,
    });
    try {
      const raw = await provider.complete(systemPrompt, userPrompt);
      const parsed = extractStructured(raw);
      const speech = typeof parsed.speech === "string" ? parsed.speech.trim() : "";
      if (!speech) return { ok: false };
      const mood = typeof parsed.mood === "string" && parsed.mood in Mood ? (parsed.mood as Mood) : undefined;
      const intent = parsed.intent != null ? String(parsed.intent) : undefined;
      return { ok: true, speech, mood, intent };
    } catch (err) {
      console.debug("[CompanionKernelProvider] 主动陪伴请求失败，静默跳过：", err);
      return { ok: false };
    }
  }
}
