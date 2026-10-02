import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { VOID_CALIBRATION } from "../void-calibration";
import { getVoidMotionSemantic } from "../void-motion-semantics";

type GazeBoneName = "head" | "neck" | "spine";

interface AxisOverlay {
  x: number;
  y: number;
}

export interface VrmGazeInput {
  x: number;
  y: number;
}

const BONE_WEIGHTS: Readonly<Record<GazeBoneName, number>> = {
  head: VOID_CALIBRATION.gaze.distribution.head,
  neck: VOID_CALIBRATION.gaze.distribution.neck,
  spine: VOID_CALIBRATION.gaze.distribution.spine,
};

export class VrmGazeController {
  private readonly overlay: Record<GazeBoneName, AxisOverlay> = {
    head: { x: 0, y: 0 },
    neck: { x: 0, y: 0 },
    spine: { x: 0, y: 0 },
  };

  clear(vrm: VRM): void {
    this.clearBone(vrm, "head");
    this.clearBone(vrm, "neck");
    this.clearBone(vrm, "spine");
  }

  apply(
    vrm: VRM,
    gaze: VrmGazeInput,
    delta: number,
    activeMotion?: string | null,
  ): void {
    if (!VOID_CALIBRATION.features.upperBodyGaze) {
      return;
    }

    const safeDelta = THREE.MathUtils.clamp(
      delta,
      0,
      VOID_CALIBRATION.stability.maxDeltaSeconds,
    );

    const gx = THREE.MathUtils.clamp(gaze.x / 8, -1, 1);
    const gy = THREE.MathUtils.clamp(gaze.y / 8, -1, 1);

    const motion = getVoidMotionSemantic(activeMotion);
    const gazeScale = motion.gazeScale;

    const targetX =
      THREE.MathUtils.clamp(
        -gy * VOID_CALIBRATION.gaze.maxPitch,
        -VOID_CALIBRATION.gaze.maxPitch,
        VOID_CALIBRATION.gaze.maxPitch,
      ) * gazeScale;

    const targetY =
      THREE.MathUtils.clamp(
        gx * VOID_CALIBRATION.gaze.maxYaw,
        -VOID_CALIBRATION.gaze.maxYaw,
        VOID_CALIBRATION.gaze.maxYaw,
      ) * gazeScale;

    const blend =
      1 -
      Math.exp(
        -safeDelta * VOID_CALIBRATION.gaze.response,
      );

    this.applyBone(vrm, "head", targetX, targetY, blend);
    this.applyBone(vrm, "neck", targetX, targetY, blend);
    this.applyBone(vrm, "spine", targetX, targetY, blend);
  }

  reset(): void {
    for (const value of Object.values(this.overlay)) {
      value.x = 0;
      value.y = 0;
    }
  }

  dispose(vrm: VRM): void {
    this.clear(vrm);
    this.reset();
  }

  private clearBone(vrm: VRM, name: GazeBoneName): void {
    const value = this.overlay[name];
    const bone = vrm.humanoid?.getNormalizedBoneNode(name);

    if (!bone) {
      value.x = 0;
      value.y = 0;
      return;
    }

    bone.rotation.x -= value.x;
    bone.rotation.y -= value.y;
  }

  private applyBone(
    vrm: VRM,
    name: GazeBoneName,
    targetX: number,
    targetY: number,
    blend: number,
  ): void {
    const value = this.overlay[name];
    const bone = vrm.humanoid?.getNormalizedBoneNode(name);

    if (!bone) {
      value.x = 0;
      value.y = 0;
      return;
    }

    const weight = BONE_WEIGHTS[name];

    value.x = THREE.MathUtils.lerp(value.x, targetX * weight, blend);
    value.y = THREE.MathUtils.lerp(value.y, targetY * weight, blend);

    bone.rotation.x += value.x;
    bone.rotation.y += value.y;
  }
}
