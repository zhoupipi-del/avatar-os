import {
  DEFAULT_AGENT_OUTPUT,
  type AgentBrainOutput,
  normalizeAgentEmotion,
  normalizeAgentIntent,
} from "./agent-intent";

export interface ParseBrainOutputOptions {
  readonly fallbackSpeech?: string;
}

export function parseBrainJsonOutput(
  raw: string,
  options: ParseBrainOutputOptions = {},
): AgentBrainOutput {
  const trimmed = raw.trim();

  if (!trimmed) {
    return {
      ...DEFAULT_AGENT_OUTPUT,
      speech: options.fallbackSpeech ?? DEFAULT_AGENT_OUTPUT.speech,
    };
  }

  const json = extractFirstJsonObject(trimmed);

  if (!json) {
    return {
      speech: trimmed,
      intent: {
        type: "NONE",
        intensity: 0,
      },
      emotion: {
        type: "neutral",
        intensity: 0,
      },
    };
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;

    return {
      speech:
        typeof parsed.speech === "string" && parsed.speech.trim()
          ? parsed.speech.trim()
          : options.fallbackSpeech ?? DEFAULT_AGENT_OUTPUT.speech,
      intent: normalizeAgentIntent(parsed.intent),
      emotion: normalizeAgentEmotion(parsed.emotion),
      ...normalizeMotionField(parsed.motion),
    };
  } catch {
    return {
      speech: trimmed,
      intent: {
        type: "NONE",
        intensity: 0,
      },
      emotion: {
        type: "neutral",
        intensity: 0,
      },
    };
  }
}

export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");

  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

/** motion 字段：只接受像 HEART / SCRATCH_HEAD 这样的 id，其余丢弃 */
export function normalizeMotionField(value: unknown): { motion?: string } {
  if (typeof value !== "string") return {};
  const id = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{1,23}$/.test(id) && id !== "NONE" ? { motion: id } : {};
}
