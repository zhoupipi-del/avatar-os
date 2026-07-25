import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { VOID_CALIBRATION } from "../void-calibration";

export interface VrmStabilityResult {
  readonly valid: boolean;
  readonly invalidNodes: readonly string[];
}

export class VrmStabilityGuard {
  private lastWarningAt = 0;

  sanitizeDelta(delta: number): number {
    if (!Number.isFinite(delta) || delta < 0) {
      this.warn("Invalid frame delta", { delta });
      return 0;
    }

    return THREE.MathUtils.clamp(
      delta,
      0,
      VOID_CALIBRATION.stability.maxDeltaSeconds,
    );
  }

  inspect(vrm: VRM): VrmStabilityResult {
    if (!import.meta.env.DEV) {
      return {
        valid: true,
        invalidNodes: [],
      };
    }

    const invalidNodes: string[] = [];

    vrm.scene.traverse((object) => {
      if (
        !this.isFiniteVector(object.position) ||
        !this.isFiniteQuaternion(object.quaternion) ||
        !this.isFiniteVector(object.scale)
      ) {
        invalidNodes.push(object.name || object.uuid);
      }
    });

    if (invalidNodes.length > 0) {
      this.warn("Invalid VRM transforms detected", {
        invalidNodes: invalidNodes.slice(0, 20),
        total: invalidNodes.length,
      });
    }

    return {
      valid: invalidNodes.length === 0,
      invalidNodes,
    };
  }

  private isFiniteVector(vector: THREE.Vector3): boolean {
    return (
      Number.isFinite(vector.x) &&
      Number.isFinite(vector.y) &&
      Number.isFinite(vector.z)
    );
  }

  private isFiniteQuaternion(quaternion: THREE.Quaternion): boolean {
    return (
      Number.isFinite(quaternion.x) &&
      Number.isFinite(quaternion.y) &&
      Number.isFinite(quaternion.z) &&
      Number.isFinite(quaternion.w)
    );
  }

  private warn(message: string, detail?: unknown): void {
    if (!import.meta.env.DEV) return;

    const now = Date.now();
    if (
      now - this.lastWarningAt <
      VOID_CALIBRATION.stability.invalidFrameWarningCooldownMs
    ) {
      return;
    }

    this.lastWarningAt = now;
    console.warn(`[VOID Stability] ${message}`, detail);
  }
}
