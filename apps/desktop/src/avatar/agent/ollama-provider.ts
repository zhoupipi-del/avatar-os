import { withRequestSignal } from "./abortable-request";
import type { LlmMessage, LlmProvider } from "./llm-provider";

export interface OllamaProviderOptions {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface OllamaChatResponse {
  readonly message?: {
    readonly role?: string;
    readonly content?: string;
  };
  readonly response?: string;
  readonly done?: boolean;
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? "http://127.0.0.1:11434",
    );
    this.model = options.model?.trim() || "qwen2.5:7b";
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    // 必须包一层再存：把原生 fetch 存成实例字段后以 this.fetchImpl(...) 调用，
    // 浏览器 / WebView2 会抛 "Illegal invocation"（this 不是 Window），导致永远回退规则脑。
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        {
          method: "GET",
        },
        Math.min(this.timeoutMs, 3000),
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  // 与 LlmProvider 接口 + JsonLlmBrain 调用保持一致：接收 systemPrompt 与 userText 两参，
  // 分别放入 system / user 角色，确保 JSON 格式指令与用户真实问题都送达。
  async complete(
    systemPrompt: string,
    userText: string,
    history: readonly LlmMessage[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    return withRequestSignal(this.timeoutMs, signal, async (requestSignal) => {
      const response = await this.fetchImpl(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          signal: requestSignal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            stream: false,
            messages: [
              {
                role: "system",
                content: systemPrompt,
              },
              ...history
                .filter((m) => m.role !== "system" && m.content.trim().length > 0)
                .map((m) => ({ role: m.role, content: m.content })),
              {
                role: "user",
                content: userText,
              },
            ],
            options: {
              temperature: 0.2,
              num_predict: 256,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Ollama request failed: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as OllamaChatResponse;
      requestSignal.throwIfAborted();
      const content = data.message?.content ?? data.response ?? "";

      if (!content.trim()) {
        throw new Error("Ollama returned empty content.");
      }

      return content;
    });
  }

  getModel(): string {
    return this.model;
  }

  getDebugConfig(): {
    readonly baseUrl: string;
    readonly model: string;
    readonly timeoutMs: number;
  } {
    return {
      baseUrl: this.baseUrl,
      model: this.model,
      timeoutMs: this.timeoutMs,
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "http://127.0.0.1:11434";
  }

  return trimmed.replace(/\/$/, "");
}

function normalizeTimeoutMs(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60000;
  }

  return Math.max(1000, Math.floor(parsed));
}
