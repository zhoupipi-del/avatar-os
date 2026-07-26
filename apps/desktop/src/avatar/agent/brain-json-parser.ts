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

function extractFirstJsonObject(text: string): string | null {
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
