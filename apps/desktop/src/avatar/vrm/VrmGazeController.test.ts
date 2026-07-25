import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { VrmGazeController } from "./VrmGazeController";
import type { VRM } from "@pixiv/three-vrm";

describe("VrmGazeController", () => {
  const createMockVrm = () => {
    const bones: Record<string, THREE.Object3D> = {
      head: new THREE.Object3D(),
      neck: new THREE.Object3D(),
      spine: new THREE.Object3D(),
    };
    return {
      vrm: {
        humanoid: {
          getNormalizedBoneNode: (name: string) => bones[name] ?? null,
        },
      } as unknown as VRM,
      bones,
    };
  };

  it("distributes gaze using 80/15/5 weights", () => {
    const { vrm, bones } = createMockVrm();
    const controller = new VrmGazeController();

    controller.apply(vrm, { x: 8, y: -8 }, 1);

    const headX = bones.head.rotation.x;
    const neckX = bones.neck.rotation.x;
    const spineX = bones.spine.rotation.x;

    expect(headX).toBeGreaterThan(0);
    expect(neckX / headX).toBeCloseTo(0.15 / 0.8, 4);
    expect(spineX / headX).toBeCloseTo(0.05 / 0.8, 4);
  });

  it("restores the animation base pose when cleared", () => {
    const { vrm, bones } = createMockVrm();
    const controller = new VrmGazeController();

    bones.head.rotation.set(0.1, 0.2, 0);

    controller.apply(vrm, { x: 8, y: -8 }, 0.05);
    controller.clear(vrm);

    expect(bones.head.rotation.x).toBeCloseTo(0.1, 6);
    expect(bones.head.rotation.y).toBeCloseTo(0.2, 6);
  });

  it("should no-op safely when bones are missing", () => {
    const emptyVrm = {
      humanoid: { getNormalizedBoneNode: () => null },
    } as unknown as VRM;
    const controller = new VrmGazeController();

    expect(() => {
      controller.clear(emptyVrm);
      controller.apply(emptyVrm, { x: 5, y: 5 }, 0.016);
    }).not.toThrow();
  });
});
