export type AgentEmotionType =
  | "neutral"
  | "happy"
  | "sad"
  | "thinking"
  | "curious"
  | "tired";

export type AgentIntentType =
  | "IDLE"
  | "GREET"
  | "GREET_ALT"
  | "PEEK"
  | "THINKING"
  | "HAPPY_IDLE"
  | "SAD_BODY"
  | "BOUNCE_HAPPY"
  | "SPEAK"
  | "LISTEN"
  | "COMFORT"
  | "NONE";

export interface AgentEmotion {
  readonly type: AgentEmotionType;
  readonly intensity: number;
}

export interface AgentIntent {
  readonly type: AgentIntentType;
  readonly intensity: number;
}

export interface AgentBrainInput {
  readonly text: string;
  readonly now?: number;
}

export interface AgentBrainOutput {
  readonly speech: string;
  readonly intent: AgentIntent;
  readonly emotion: AgentEmotion;
}

export interface AgentBrain {
  think(input: AgentBrainInput): Promise<AgentBrainOutput>;
}

export interface AgentBodyBridge {
  speakText(text: string): void;
  playIntent(intent: AgentIntent): void;
  setEmotion(emotion: AgentEmotion): void;
  stop?(): void;
}

export const DEFAULT_AGENT_OUTPUT: AgentBrainOutput = {
  speech: "我在。",
  intent: {
    type: "NONE",
    intensity: 0,
  },
  emotion: {
    type: "neutral",
    intensity: 0,
  },
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

export function normalizeAgentIntent(
  value: unknown,
): AgentIntent {
  if (!value || typeof value !== "object") {
    return DEFAULT_AGENT_OUTPUT.intent;
  }

  const record = value as Record<string, unknown>;
  const rawType = String(record.type ?? "NONE").toUpperCase();

  const allowed = new Set<AgentIntentType>([
    "IDLE",
    "GREET",
    "GREET_ALT",
    "PEEK",
    "THINKING",
    "HAPPY_IDLE",
    "SAD_BODY",
    "BOUNCE_HAPPY",
    "SPEAK",
    "LISTEN",
    "COMFORT",
    "NONE",
  ]);

  const type = allowed.has(rawType as AgentIntentType)
    ? (rawType as AgentIntentType)
    : "NONE";

  return {
    type,
    intensity: clamp01(Number(record.intensity ?? 0.6)),
  };
}

export function normalizeAgentEmotion(
  value: unknown,
): AgentEmotion {
  if (!value || typeof value !== "object") {
    return DEFAULT_AGENT_OUTPUT.emotion;
  }

  const record = value as Record<string, unknown>;
  const rawType = String(record.type ?? "neutral").toLowerCase();

  const allowed = new Set<AgentEmotionType>([
    "neutral",
    "happy",
    "sad",
    "thinking",
    "curious",
    "tired",
  ]);

  const type = allowed.has(rawType as AgentEmotionType)
    ? (rawType as AgentEmotionType)
    : "neutral";

  return {
    type,
    intensity: clamp01(Number(record.intensity ?? 0.4)),
  };
}
