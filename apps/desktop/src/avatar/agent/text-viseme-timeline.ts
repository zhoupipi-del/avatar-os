export type MouthShape = "aa" | "ih" | "ou" | "ee" | "oh";

export interface TextVisemeTimelineOptions {
  readonly msPerChar?: number;
  readonly punctuationPauseMs?: number;
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
  readonly now?: () => number;
}

export interface TextVisemeFrame {
  readonly active: boolean;
  readonly progress: number;
  readonly primary: MouthShape | null;
  readonly secondary: MouthShape | null;
  readonly primaryWeight: number;
  readonly secondaryWeight: number;
  readonly intensity: number;
  readonly phase: "rest" | "opening" | "open" | "closing";
}

export interface TextVisemeTimelineStatus extends TextVisemeFrame {
  readonly textLength: number;
  readonly startedAt: number | null;
  readonly estimatedEndsAt: number | null;
  readonly estimatedDurationMs: number;
}

interface VisemeSegment {
  readonly shape: MouthShape;
  readonly startMs: number;
  readonly endMs: number;
  readonly emphasis: number;
}

const SHAPES: MouthShape[] = ["aa", "ih", "ou", "ee", "oh"];

const LATIN_VOWEL_TO_SHAPE: Record<string, MouthShape> = {
  a: "aa",
  e: "ee",
  i: "ih",
  o: "oh",
  u: "ou",
};

export class TextVisemeTimeline {
  private readonly msPerChar: number;
  private readonly punctuationPauseMs: number;
  private readonly minDurationMs: number;
  private readonly maxDurationMs: number;
  private readonly now: () => number;

  private text = "";
  private startedAt: number | null = null;
  private estimatedDurationMs = 0;
  private segments: VisemeSegment[] = [];

  constructor(options: TextVisemeTimelineOptions = {}) {
    this.msPerChar = clampNumber(options.msPerChar ?? 150, 40, 500);
    this.punctuationPauseMs = clampNumber(options.punctuationPauseMs ?? 180, 0, 1200);
    this.minDurationMs = clampNumber(options.minDurationMs ?? 600, 100, 10000);
    this.maxDurationMs = clampNumber(options.maxDurationMs ?? 12000, 1000, 60000);
    this.now = options.now ?? (() => performance.now());
  }

  startText(text: string): void {
    const content = text.trim();

    if (!content) {
      this.cancel();
      return;
    }

    this.text = content;
    this.startedAt = this.now();
    this.estimatedDurationMs = estimateDurationMs({
      text: content,
      msPerChar: this.msPerChar,
      punctuationPauseMs: this.punctuationPauseMs,
      minDurationMs: this.minDurationMs,
      maxDurationMs: this.maxDurationMs,
    });
    this.segments = buildSegments(content, this.estimatedDurationMs);
  }

  cancel(): void {
    this.text = "";
    this.startedAt = null;
    this.estimatedDurationMs = 0;
    this.segments = [];
  }

  update(): TextVisemeFrame {
    if (this.startedAt === null || this.estimatedDurationMs <= 0) {
      return restFrame();
    }

    const elapsed = this.now() - this.startedAt;

    if (elapsed >= this.estimatedDurationMs) {
      this.cancel();
      return restFrame();
    }

    return this.frameAt(elapsed);
  }

  getStatus(): TextVisemeTimelineStatus {
    const frame = this.startedAt === null ? restFrame() : this.frameAt(this.now() - this.startedAt);

    return {
      ...frame,
      textLength: this.text.length,
      startedAt: this.startedAt,
      estimatedEndsAt:
        this.startedAt === null ? null : this.startedAt + this.estimatedDurationMs,
      estimatedDurationMs: this.estimatedDurationMs,
    };
  }

  private frameAt(elapsedMs: number): TextVisemeFrame {
    if (this.segments.length === 0 || this.estimatedDurationMs <= 0) {
      return restFrame();
    }

    const progress = clampNumber(elapsedMs / this.estimatedDurationMs, 0, 1);
    const current = this.segments.find(
      (segment) => elapsedMs >= segment.startMs && elapsedMs < segment.endMs,
    );

    if (!current) {
      return {
        ...restFrame(),
        active: true,
        progress,
      };
    }

    const local = clampNumber(
      (elapsedMs - current.startMs) / Math.max(1, current.endMs - current.startMs),
      0,
      1,
    );

    const envelope = mouthEnvelope(local);
    const phase = phaseFromLocal(local);
    const next = nextSegment(this.segments, current);
    const secondary = next?.shape !== current.shape ? next?.shape ?? null : null;

    return {
      active: true,
      progress,
      primary: current.shape,
      secondary,
      primaryWeight: clampNumber(envelope * current.emphasis, 0, 1),
      secondaryWeight: secondary ? clampNumber(envelope * 0.35, 0, 0.5) : 0,
      intensity: clampNumber(envelope * current.emphasis, 0, 1),
      phase,
    };
  }
}

export function estimateDurationMs(input: {
  readonly text: string;
  readonly msPerChar: number;
  readonly punctuationPauseMs: number;
  readonly minDurationMs: number;
  readonly maxDurationMs: number;
}): number {
  const punctuationCount = Array.from(input.text).filter(isPauseChar).length;
  const base = input.text.length * input.msPerChar;
  const withPauses = base + punctuationCount * input.punctuationPauseMs;

  return clampNumber(withPauses, input.minDurationMs, input.maxDurationMs);
}

function buildSegments(text: string, durationMs: number): VisemeSegment[] {
  const chars = Array.from(text).filter((char) => !isWhitespace(char));
  const voicedChars = chars.filter((char) => !isPauseChar(char));

  if (voicedChars.length === 0) {
    return [];
  }

  const segmentMs = durationMs / voicedChars.length;

  return voicedChars.map((char, index) => {
    const shape = shapeForChar(char, index);
    const startMs = index * segmentMs;
    const endMs = (index + 1) * segmentMs;

    return {
      shape,
      startMs,
      endMs,
      emphasis: emphasisForChar(char),
    };
  });
}

function shapeForChar(char: string, index: number): MouthShape {
  const lower = char.toLowerCase();

  if (LATIN_VOWEL_TO_SHAPE[lower]) {
    return LATIN_VOWEL_TO_SHAPE[lower];
  }

  const code = char.codePointAt(0) ?? index;
  return SHAPES[(code + index) % SHAPES.length];
}

function emphasisForChar(char: string): number {
  if (/[aAoO啊哈呀嘛吧大]/u.test(char)) {
    return 1;
  }

  if (/[iIeE一你里气七]/u.test(char)) {
    return 0.78;
  }

  if (/[uUoO呜不我哦]/u.test(char)) {
    return 0.84;
  }

  return 0.68;
}

function mouthEnvelope(local: number): number {
  if (local < 0.18) {
    return smoothStep(local / 0.18);
  }

  if (local > 0.72) {
    return 1 - smoothStep((local - 0.72) / 0.28);
  }

  return 1;
}

function phaseFromLocal(local: number): TextVisemeFrame["phase"] {
  if (local < 0.18) {
    return "opening";
  }

  if (local > 0.72) {
    return "closing";
  }

  return "open";
}

function nextSegment(
  segments: readonly VisemeSegment[],
  current: VisemeSegment,
): VisemeSegment | null {
  const index = segments.indexOf(current);
  return index >= 0 ? segments[index + 1] ?? null : null;
}

function restFrame(): TextVisemeFrame {
  return {
    active: false,
    progress: 0,
    primary: null,
    secondary: null,
    primaryWeight: 0,
    secondaryWeight: 0,
    intensity: 0,
    phase: "rest",
  };
}

function smoothStep(value: number): number {
  const x = clampNumber(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function isPauseChar(char: string): boolean {
  return /[，。！？、,.!?;；:：]/u.test(char);
}

function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}
