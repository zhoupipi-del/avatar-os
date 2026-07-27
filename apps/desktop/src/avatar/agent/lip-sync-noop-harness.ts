export interface LipShapeProbeLike {
  readonly available: boolean;
  readonly availableShapes: readonly string[];
  readonly missingShapes?: readonly string[];
}

export interface LipSyncNoopHarnessOptions {
  readonly enabled?: boolean;
  readonly estimateMsPerChar?: number;
  readonly minSpeechMs?: number;
  readonly maxSpeechMs?: number;
  readonly now?: () => number;
}

export interface LipSyncNoopStatus {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly mode: "disabled" | "missing-shapes" | "probe-ready" | "speaking-text";
  readonly speaking: boolean;
  readonly lastText: string | null;
  readonly availableShapes: readonly string[];
  readonly missingShapes: readonly string[];
  readonly speechStartedAt: number | null;
  readonly estimatedSpeechEndsAt: number | null;
}

export class LipSyncNoopHarness {
  private enabled: boolean;
  private probe: LipShapeProbeLike = {
    available: false,
    availableShapes: [],
    missingShapes: ["a", "i", "u", "e", "o"],
  };

  private lastText: string | null = null;
  private speechStartedAt: number | null = null;
  private estimatedSpeechEndsAt: number | null = null;

  private readonly estimateMsPerChar: number;
  private readonly minSpeechMs: number;
  private readonly maxSpeechMs: number;
  private readonly now: () => number;

  constructor(options: LipSyncNoopHarnessOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.estimateMsPerChar = clampNumber(options.estimateMsPerChar ?? 160, 40, 500);
    this.minSpeechMs = clampNumber(options.minSpeechMs ?? 800, 100, 10000);
    this.maxSpeechMs = clampNumber(options.maxSpeechMs ?? 12000, 1000, 60000);
    this.now = options.now ?? (() => Date.now());
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      this.cancel();
    }
  }

  setProbeResult(probe: LipShapeProbeLike): void {
    this.probe = normalizeProbe(probe);
  }

  notifySpeechText(text: string): void {
    const content = text.trim();

    if (!this.enabled || !content) {
      return;
    }

    this.lastText = content;
    this.speechStartedAt = this.now();

    const estimatedDuration = clampNumber(
      content.length * this.estimateMsPerChar,
      this.minSpeechMs,
      this.maxSpeechMs,
    );

    this.estimatedSpeechEndsAt = this.speechStartedAt + estimatedDuration;
  }

  cancel(): void {
    this.speechStartedAt = null;
    this.estimatedSpeechEndsAt = null;
  }

  /**
   * Day7 intentionally does not write VRM expressions.
   * This method exists only to expire debug state over time.
   */
  update(): void {
    if (
      this.estimatedSpeechEndsAt !== null &&
      this.now() >= this.estimatedSpeechEndsAt
    ) {
      this.cancel();
    }
  }

  getStatus(): LipSyncNoopStatus {
    const speaking =
      this.enabled &&
      this.speechStartedAt !== null &&
      this.estimatedSpeechEndsAt !== null &&
      this.now() < this.estimatedSpeechEndsAt;

    return {
      enabled: this.enabled,
      available: this.probe.available,
      mode: getMode({
        enabled: this.enabled,
        available: this.probe.available,
        speaking,
      }),
      speaking,
      lastText: this.lastText,
      availableShapes: [...this.probe.availableShapes],
      missingShapes: [...(this.probe.missingShapes ?? [])],
      speechStartedAt: this.speechStartedAt,
      estimatedSpeechEndsAt: this.estimatedSpeechEndsAt,
    };
  }
}

function getMode(input: {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly speaking: boolean;
}): LipSyncNoopStatus["mode"] {
  if (!input.enabled) {
    return "disabled";
  }

  if (!input.available) {
    return "missing-shapes";
  }

  if (input.speaking) {
    return "speaking-text";
  }

  return "probe-ready";
}

function normalizeProbe(probe: LipShapeProbeLike): LipShapeProbeLike {
  const availableShapes = [...new Set(probe.availableShapes)].filter(Boolean);
  const expected = ["a", "i", "u", "e", "o"];
  const missingShapes =
    probe.missingShapes ??
    expected.filter((shape) => !availableShapes.includes(shape));

  return {
    available: probe.available,
    availableShapes,
    missingShapes,
  };
}

function clampNumber(
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}
