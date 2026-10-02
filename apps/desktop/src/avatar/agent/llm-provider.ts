/**
 * LlmProvider —— LLM 供应商抽象（Day2 JSON LLM Brain）
 *
 * 只定义“发一次补全请求、拿回原始文本”的最小契约。
 * 本阶段唯一实现是 OllamaProvider（不接 OpenAI）。
 */
export interface LlmMessage {
  readonly role: "system" | "user" | "assitant";
  readonly content: string;
}

export interface LlmProvider {
  /** 供应商名（用于日志/调试） */
  readonly name: string;

  /**
   * 发送一次补全请求，返回模型原始文本。
   * 文本可能夹带 JSON 之外的说明文字 —— 由 JsonLlmBrain 负责解析。
   * 不可用时必须 reject（JsonLlmBrain 会据此回退 RuleBasedBrain）。
   */
  complete(systemPrompt: string, userText: string): Promise<string>;

  /** 健康检查：供应商是否可达（可选，供上层策略使用） */
  isAvailable(): Promise<boolean>;
}
