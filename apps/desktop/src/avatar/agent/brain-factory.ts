import type { AgentBrain } from "./agent-intent";
import { JsonLlmBrain } from "./json-llm-brain";
import { OllamaProvider } from "./ollama-provider";
import { RuleBasedBrain } from "./rule-based-brain";

export interface DemoBrainEnvironment {
  readonly VITE_AVATAROS_BRAIN_MODE?: string;
  readonly VITE_OLLAMA_ENDPOINT?: string;
  readonly VITE_OLLAMA_MODEL?: string;
  readonly VITE_OLLAMA_TIMEOUT_MS?: string;
}

export interface DemoBrainConfig {
  readonly mode: "rule" | "ollama";
  readonly ollama: {
    readonly baseUrl: string;
    readonly model: string;
    readonly timeoutMs: number;
  };
}

export interface CreateDefaultDemoBrainOptions {
  readonly env?: DemoBrainEnvironment;
  readonly fetchImpl?: typeof fetch;
}

export function createDefaultDemoBrain(
  options: CreateDefaultDemoBrainOptions = {},
): AgentBrain {
  const config = readDemoBrainConfig(options.env ?? importMetaDemoEnv());

  if (config.mode === "rule") {
    return new RuleBasedBrain();
  }

  return new JsonLlmBrain(
    new OllamaProvider({
      baseUrl: config.ollama.baseUrl,
      model: config.ollama.model,
      timeoutMs: config.ollama.timeoutMs,
      fetchImpl: options.fetchImpl,
    }),
    { fallback: new RuleBasedBrain() },
  );
}

export function readDemoBrainConfig(
  env: DemoBrainEnvironment,
): DemoBrainConfig {
  const rawMode = env.VITE_AVATAROS_BRAIN_MODE?.trim().toLowerCase();

  return {
    mode: rawMode === "rule" ? "rule" : "ollama",
    ollama: {
      baseUrl:
        env.VITE_OLLAMA_ENDPOINT?.trim() ||
        "http://127.0.0.1:11434",
      model:
        env.VITE_OLLAMA_MODEL?.trim() ||
        "qwen2.5:7b",
      timeoutMs: normalizeTimeoutMs(env.VITE_OLLAMA_TIMEOUT_MS),
    },
  };
}

// import.meta.env 的 ImportMetaEnv 类型与 DemoBrainEnvironment 不一定结构化兼容，
// 这里显式取出 4 个 VITE_ 变量并收窄成 DemoBrainEnvironment，避免整体传参的类型冲突。
function importMetaDemoEnv(): DemoBrainEnvironment {
  const e = import.meta.env as unknown as Partial<DemoBrainEnvironment>;
  return {
    VITE_AVATAROS_BRAIN_MODE: e.VITE_AVATAROS_BRAIN_MODE,
    VITE_OLLAMA_ENDPOINT: e.VITE_OLLAMA_ENDPOINT,
    VITE_OLLAMA_MODEL: e.VITE_OLLAMA_MODEL,
    VITE_OLLAMA_TIMEOUT_MS: e.VITE_OLLAMA_TIMEOUT_MS,
  };
}

function normalizeTimeoutMs(value: string | undefined): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60000;
  }

  return Math.max(1000, Math.floor(parsed));
}
