export type LipSyncRhythmPhase = "rest" | "opening" | "open" | "closing";

export interface LipSyncTextRhythmOptions {
  readonly enabled?: boolean;
  readonly msPerChar?: number;
  readonly minMs?: number;
  readonly maxMs?: number;
  readonly charsPerCycle?: number;
  readonly maxCycles?: number;
  readonly now?: () => number;
}

export interface LipSyncRhythmStatus {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly phase: LipSyncRhythmPhase;
  readonly intensity: number;
  readonly progress: number;
  readonly startedAt: number | null;
  readonly estimatedEndsAt: number | null;
  readonly estimatedDurationMs: number;
  readonly textLength: number;
}

const DEFAULT_MS_PER_CHAR = 160;
const DEFAULT_MIN_MS = 800;
const DEFAULT_MAX_MS = 12000;
const DEFAULT_CHARS_PER_CYCLE = 3;
const DEFAULT_MAX_CYCLES = 12;

/**
 * Day8 Text Rhythm State Driver.
 *
 * 把 speech 文本转成「可观察的节奏状态」(phase / intensity / progress / timing)，
 * 为后续 Day9 真实嘴型驱动铺路。本阶段 **不写 VRM expression**、**不驱动嘴型**、
 * **不接 AudioContext**、**不做 VisemeFrame**。
 *
 * 状态完全由文本长度 + 标点估算的虚拟时长驱动，与音频无关。
 */
export class LipSyncTextRhythmDriver {
  private enabled: boolean;
  private active = false;
  private phase: LipSyncRhythmPhase = "rest";
  private intensity = 0;
  private progress = 0;
  private startedAt: number | null = null;
  private estimatedEndsAt: number | null = null;
  private estimatedDurationMs = 0;
  private textLength = 0;
  private cycles = 1;

  private readonly msPerChar: number;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly charsPerCycle: number;
  private readonly maxCycles: number;
  private readonly now: () => number;

  constructor(options: LipSyncTextRhythmOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.msPerChar = clampNumber(options.msPerChar ?? DEFAULT_MS_PER_CHAR, 40, 500);
    this.minMs = clampNumber(options.minMs ?? DEFAULT_MIN_MS, 100, 10000);
    this.maxMs = clampNumber(options.maxMs ?? DEFAULT_MAX_MS, 1000, 60000);
    this.charsPerCycle = clampNumber(
      options.charsPerCycle ?? DEFAULT_CHARS_PER_CYCLE,
      1,
      20,
    );
    this.maxCycles = clampNumber(options.maxCycles ?? DEFAULT_MAX_CYCLES, 1, 40);
    this.now = options.now ?? (() => Date.now());
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      this.cancel();
    }
  }

  startText(text: string): void {
    const content = (text ?? "").trim();

    if (!this.enabled || !content) {
      return;
    }

    this.textLength = content.length;
    this.startedAt = this.now();
    this.estimatedDurationMs = clampNumber(
      content.length * this.msPerChar,
      this.minMs,
      this.maxMs,
    );
    this.estimatedEndsAt = this.startedAt + this.estimatedDurationMs;
    this.cycles = clampNumber(
      Math.round(content.length / this.charsPerCycle),
      1,
      this.maxCycles,
    );
    this.active = true;
    this.phase = "opening";
    this.intensity = 0;
    this.progress = 0;
  }

  cancel(): void {
    this.active = false;
    this.phase = "rest";
    this.intensity = 0;
    this.progress = 0;
    this.startedAt = null;
    this.estimatedEndsAt = null;
  }

  /**
   * Day8 intentionally does NOT write VRM expressions.
   * update() only advances the internal rhythm state for Debug display.
   */
  update(): void {
    if (
      !this.active ||
      this.startedAt === null ||
      this.estimatedEndsAt === null
    ) {
      return;
    }

    const elapsed = this.now() - this.startedAt;
    const progress = clampNumber(
      elapsed / Math.max(1, this.estimatedDurationMs),
      0,
      1,
    );
    this.progress = progress;

    if (progress >= 1) {
      // 自然结束：回到 rest，但保留 progress=1 表示「已完成」
      this.active = false;
      this.phase = "rest";
      this.intensity = 0;
      this.startedAt = null;
      this.estimatedEndsAt = null;
      return;
    }

    const wave = Math.sin(progress * Math.PI * 2 * this.cycles);
    this.intensity = clampNumber((wave + 1) / 2, 0, 1);

    if (wave > 0.6) {
      this.phase = "open";
    } else if (wave > 0.1) {
      this.phase = "opening";
    } else if (wave > -0.4) {
      this.phase = "closing";
    } else {
      this.phase = "rest";
    }
  }

  getStatus(): LipSyncRhythmStatus {
    return {
      enabled: this.enabled,
      active: this.active,
      phase: this.phase,
      intensity: this.intensity,
      progress: this.progress,
      startedAt: this.startedAt,
      estimatedEndsAt: this.estimatedEndsAt,
      estimatedDurationMs: this.estimatedDurationMs,
      textLength: this.textLength,
    };
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}
