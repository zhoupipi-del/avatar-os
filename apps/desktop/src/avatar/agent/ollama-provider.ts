import type { LlmProvider } from "./llm-provider";

export interface OllamaProviderOptions {
  /** Ollama 服务地址，默认 http://127.0.0.1:11434 */
  readonly baseUrl?: string;
  /** 模型名，默认 qwen2.5:7b；可改 qwen2.5:14b */
  readonly model?: string;
  /** 可注入的 fetch 实现（测试用；默认全局 fetch） */
  readonly fetchImpl?: typeof fetch;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

/**
 * OllamaProvider —— 本地 Ollama 供应商（Day2 默认）
 *
 * 走 /api/chat（非流式），只取 message.content。
 * 不接 OpenAI / TTS / LipSync / Memory / Relationship。
 */
export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
    this.model = options.model ?? "qwen2.5:7b";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        method: "GET",
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(systemPrompt: string, userText: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const content = data?.message?.content;

    if (typeof content !== "string") {
      throw new Error("Ollama response missing message.content");
    }

    return content;
  }
}
