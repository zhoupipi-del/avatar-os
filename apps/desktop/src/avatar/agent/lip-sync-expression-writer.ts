import type { MouthShape, TextVisemeFrame } from "./text-viseme-timeline";

export const LIP_SYNC_MOUTH_SHAPES: readonly MouthShape[] = [
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
] as const;

export interface LipSyncExpressionManagerLike {
  setValue(name: string, value: number): void;
}

export interface LipSyncExpressionWriterOptions {
  readonly enabled?: boolean;
  readonly cap?: number;
  readonly attack?: number;
  readonly release?: number;
}

export interface LipSyncExpressionWriterStatus {
  readonly enabled: boolean;
  readonly probeAvailable: boolean;
  readonly active: boolean;
  readonly currentShape: MouthShape | null;
  readonly currentWeight: number;
  readonly resetCount: number;
  readonly lastError: string | null;
  readonly weights: Readonly<Record<MouthShape, number>>;
}

export class LipSyncExpressionWriter {
  private enabled: boolean;
  private probeAvailable = false;
  private readonly cap: number;
  private readonly attack: number;
  private readonly release: number;

  private resetCount = 0;
  private lastError: string | null = null;
  private currentShape: MouthShape | null = null;
  private currentWeight = 0;

  private readonly smoothState: Record<MouthShape, number> = {
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
  };

  constructor(options: LipSyncExpressionWriterOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.cap = clampNumber(options.cap ?? 0.7, 0, 1);
    this.attack = clampNumber(options.attack ?? 50, 1, 200);
    this.release = clampNumber(options.release ?? 30, 1, 200);
  }

  setEnabled(enabled: boolean, manager?: LipSyncExpressionManagerLike | null): void {
    this.enabled = enabled;

    if (!enabled) {
      this.resetAll(manager);
    }
  }

  setProbeAvailable(available: boolean, manager?: LipSyncExpressionManagerLike | null): void {
    this.probeAvailable = available;

    if (!available) {
      this.resetAll(manager);
    }
  }

  applyFrame(
    manager: LipSyncExpressionManagerLike | null | undefined,
    frame: TextVisemeFrame,
    delta = 0.016,
  ): void {
    if (!manager || !this.enabled || !this.probeAvailable || !frame.active) {
      this.resetAll(manager);
      return;
    }

    const target = this.buildTarget(frame);
    this.writeTarget(manager, target, delta);
  }

  resetAll(manager?: LipSyncExpressionManagerLike | null): void {
    for (const shape of LIP_SYNC_MOUTH_SHAPES) {
      this.smoothState[shape] = 0;
    }

    this.currentShape = null;
    this.currentWeight = 0;
    this.resetCount += 1;

    if (!manager) {
      return;
    }

    try {
      for (const shape of LIP_SYNC_MOUTH_SHAPES) {
        manager.setValue(shape, 0);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  getStatus(): LipSyncExpressionWriterStatus {
    return {
      enabled: this.enabled,
      probeAvailable: this.probeAvailable,
      active: this.enabled && this.probeAvailable && this.currentShape !== null,
      currentShape: this.currentShape,
      currentWeight: this.currentWeight,
      resetCount: this.resetCount,
      lastError: this.lastError,
      weights: { ...this.smoothState },
    };
  }

  private buildTarget(frame: TextVisemeFrame): Record<MouthShape, number> {
    const target: Record<MouthShape, number> = {
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0,
    };

    if (frame.primary) {
      target[frame.primary] = Math.min(this.cap, frame.primaryWeight);
    }

    if (frame.secondary && frame.secondary !== frame.primary) {
      target[frame.secondary] = Math.min(this.cap * 0.5, frame.secondaryWeight);
    }

    return target;
  }

  private writeTarget(
    manager: LipSyncExpressionManagerLike,
    target: Record<MouthShape, number>,
    delta: number,
  ): void {
    let bestShape: MouthShape | null = null;
    let bestWeight = 0;

    try {
      for (const shape of LIP_SYNC_MOUTH_SHAPES) {
        const from = this.smoothState[shape];
        const to = target[shape];
        const rate = 1 - Math.exp(-(to > from ? this.attack : this.release) * delta);
        const next = from + (to - from) * rate;
        const weight = next <= 0.01 ? 0 : next;

        this.smoothState[shape] = weight;

        if (weight > bestWeight) {
          bestWeight = weight;
          bestShape = shape;
        }

        manager.setValue(shape, weight);
      }

      this.currentShape = bestShape;
      this.currentWeight = bestWeight;
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}
