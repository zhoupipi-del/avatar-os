import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { VOID_CALIBRATION } from "../void-calibration";

type BlinkPhase = "waiting" | "closing" | "holding" | "opening" | "double-gap";

export type BlinkRandomSource = () => number;

export class VrmBlinkController {
  private phase: BlinkPhase = "waiting";
  private phaseElapsed = 0;
  private waitRemaining = 0;
  private doubleBlinkPending = false;

  constructor(
    private readonly vrm: VRM,
    private readonly random: BlinkRandomSource = Math.random,
  ) {
    this.scheduleNext();
    this.writeBlink(0);
  }

  update(delta: number): void {
    if (!VOID_CALIBRATION.features.naturalBlink) {
      this.writeBlink(0);
      return;
    }

    const safeDelta = THREE.MathUtils.clamp(
      delta,
      0,
      VOID_CALIBRATION.stability.maxDeltaSeconds,
    );

    switch (this.phase) {
      case "waiting":
        this.updateWaiting(safeDelta);
        break;
      case "closing":
        this.updateClosing(safeDelta);
        break;
      case "holding":
        this.updateHolding(safeDelta);
        break;
      case "opening":
        this.updateOpening(safeDelta);
        break;
      case "double-gap":
        this.updateDoubleGap(safeDelta);
        break;
    }
  }

  reset(): void {
    this.phase = "waiting";
    this.phaseElapsed = 0;
    this.doubleBlinkPending = false;
    this.scheduleNext();
    this.writeBlink(0);
  }

  private updateWaiting(delta: number): void {
    this.writeBlink(0);
    this.waitRemaining -= delta;
    if (this.waitRemaining <= 0) {
      this.beginBlink();
    }
  }

  private updateClosing(delta: number): void {
    this.phaseElapsed += delta;
    const progress = THREE.MathUtils.clamp(
      this.phaseElapsed / VOID_CALIBRATION.blink.closeSeconds,
      0,
      1,
    );
    this.writeBlink(this.smoothStep(progress));

    if (progress >= 1) {
      this.phase = "holding";
      this.phaseElapsed = 0;
    }
  }

  private updateHolding(delta: number): void {
    this.phaseElapsed += delta;
    this.writeBlink(1);

    if (this.phaseElapsed >= VOID_CALIBRATION.blink.holdSeconds) {
      this.phase = "opening";
      this.phaseElapsed = 0;
    }
  }

  private updateOpening(delta: number): void {
    this.phaseElapsed += delta;
    const progress = THREE.MathUtils.clamp(
      this.phaseElapsed / VOID_CALIBRATION.blink.openSeconds,
      0,
      1,
    );
    this.writeBlink(1 - this.smoothStep(progress));

    if (progress < 1) {
      return;
    }

    this.writeBlink(0);
    this.phaseElapsed = 0;

    if (this.doubleBlinkPending) {
      this.doubleBlinkPending = false;
      this.phase = "double-gap";
      return;
    }

    this.phase = "waiting";
    this.scheduleNext();
  }

  private updateDoubleGap(delta: number): void {
    this.phaseElapsed += delta;
    this.writeBlink(0);

    if (this.phaseElapsed >= VOID_CALIBRATION.blink.doubleBlinkGapSeconds) {
      this.phase = "closing";
      this.phaseElapsed = 0;
    }
  }

  private beginBlink(): void {
    this.phase = "closing";
    this.phaseElapsed = 0;
    this.doubleBlinkPending =
      this.random() < VOID_CALIBRATION.blink.doubleBlinkChance;
  }

  private scheduleNext(): void {
    const { minIntervalSeconds, maxIntervalSeconds } = VOID_CALIBRATION.blink;
    this.waitRemaining =
      minIntervalSeconds +
      this.random() * (maxIntervalSeconds - minIntervalSeconds);
  }

  private writeBlink(value: number): void {
    this.vrm.expressionManager?.setValue(
      "blink",
      THREE.MathUtils.clamp(value, 0, 1),
    );
  }

  private smoothStep(value: number): number {
    return value * value * (3 - 2 * value);
  }
}
