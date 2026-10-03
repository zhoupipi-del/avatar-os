import { withRequestSignal } from "./abortable-request";
import type { LlmMessage, LlmProvider } from "./llm-provider";

/**
 * OpenAICompatibleProvider —— 云端大模型（OpenAI Chat Completions 兼容接口）
 *
 * 国内主流厂商（DeepSeek、阿里百炼/通义千问、Kimi、智谱、火山方舟等）都提供兼容接口：
 *   POST {baseUrl}/chat/completions   Authorization: Bearer <apiKey>
 * 因此一个实现 + 不同 baseUrl/model 即可切换厂商。
 */
export interface OpenAICompatibleOptions {
  /** 例：https://api.deepseek.com 或 https://dashscope.aliyuncs.com/compatible-mode/v1 */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** 显示名（Brain 灯悬停提示用），如 "DeepSeek" */
  readonly label?: string;
  /** 是否请求 response_format={type:"json_object"}（厂商支持时更稳） */
  readonly jsonMode?: boolean;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string | null };
  }>;
  readonly error?: { readonly message?: string };
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly jsonMode: boolean;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private lastError: string | null = null;

  constructor(options: OpenAICompatibleOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.name = options.label?.trim() || "cloud";
    this.jsonMode = options.jsonMode ?? false;
    this.temperature = options.temperature ?? 0.8;
    this.maxTokens = options.maxTokens ?? 400;
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? 30000);
    // 包一层：直接存原生 fetch 再以 this.fetchImpl() 调用会触发 Illegal invocation
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * 可达性 + Key 有效性探测：GET {baseUrl}/models。
   * 401/403 → Key 无效；404 → 该厂商没有 /models 端点但服务可达，视为可用。
   */
  async isAvailable(): Promise<boolean> {
    const configError = this.configError();
    if (configError) {
      this.lastError = configError;
      return false;
    }
    try {
      const res = await this.request(`${this.baseUrl}/models`, { method: "GET" }, Math.min(this.timeoutMs, 8000));
      if (res.ok || res.status === 404 || res.status === 405) {
        this.lastError = null;
        return true;
      }
      this.lastError = describeHttpError(res.status, await safeText(res));
      return false;
    } catch (error) {
      this.lastError = describeNetworkError(error);
      return false;
    }
  }

  async complete(
    systemPrompt: string,
    userText: string,
    history: readonly LlmMessage[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    const configError = this.configError();
    if (configError) {
      this.lastError = configError;
      throw new Error(configError);
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        ...history
          .filter((m) => m.role !== "system" && m.content.trim().length > 0)
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userText },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: false,
    };
    if (this.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    try {
      return await withRequestSignal(this.timeoutMs, signal, async (requestSignal) => {
        const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
          signal: requestSignal,
        });
        if (!res.ok) throw new Error(describeHttpError(res.status, await safeText(res)));
        const data = (await res.json()) as ChatCompletionResponse;
        requestSignal.throwIfAborted();
        const content = data.choices?.[0]?.message?.content ?? "";
        if (!content.trim()) throw new Error(data.error?.message ?? "模型返回了空内容");
        this.lastError = null;
        return content;
      });
    } catch (error) {
      signal?.throwIfAborted();
      this.lastError = error instanceof Error && error.name !== "AbortError"
        ? error.message : describeNetworkError(error);
      throw new Error(this.lastError);
    }
  }

  private configError(): string | null {
    if (!this.apiKey) return "未填写 API Key";
    if (!this.baseUrl) return "未填写接口地址";
    if (!this.model) return "未填写模型名";
    return null;
  }

  private async request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

export function describeHttpError(status: number, detail = ""): string {
  const hint =
    status === 401 || status === 403
      ? "API Key 无效或无权限"
      : status === 402
        ? "账户余额不足"
        : status === 404
          ? "接口地址或模型名不对"
          : status === 429
            ? "请求太频繁或额度用完"
            : status >= 500
              ? "厂商服务暂时不可用"
              : "请求失败";
  return `${hint}（HTTP ${status}${detail ? `：${detail}` : ""}）`;
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "请求超时";
  const msg = error instanceof Error ? error.message : String(error);
  return `网络错误：${msg}`;
}
