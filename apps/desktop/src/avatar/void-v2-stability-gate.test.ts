import { describe, it, expect } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { VOID_MOTION_SEMANTICS } from "./void-motion-semantics";
import {
  validateVoidV2RuntimeGate,
  assertVoidV2RuntimeGate,
  formatVoidV2GateResult,
} from "./void-v2-stability-gate";

// ── Mock helpers ──

function createMockVrm(options?: {
  bones?: Partial<Record<string, THREE.Object3D | null>>;
  lookAtTarget?: THREE.Object3D | null;
  lookAtAutoUpdate?: boolean;
  hasLookAt?: boolean;
}): VRM {
  const defaultBones: Record<string, THREE.Object3D> = {
    head: new THREE.Object3D(),
    neck: new THREE.Object3D(),
    spine: new THREE.Object3D(),
    chest: new THREE.Object3D(),
  };

  const bones = { ...defaultBones, ...options?.bones };

  const lookAt =
    options?.hasLookAt === false
      ? null
      : {
          target: options?.lookAtTarget ?? null,
          autoUpdate: options?.lookAtAutoUpdate ?? false,
        };

  return {
    humanoid: {
      getNormalizedBoneNode: (name: string) => bones[name] ?? null,
    },
    lookAt,
  } as unknown as VRM;
}

function allVoidActionNames(): string[] {
  return Object.keys(VOID_MOTION_SEMANTICS);
}

// ── Tests ──

describe("void-v2-stability-gate", () => {
  it("passes with all checks satisfied (full input)", () => {
    const result = validateVoidV2RuntimeGate({
      vrm: createMockVrm(),
      actionNames: allVoidActionNames(),
      productBodyIds: ["void-vrm"],
      defaultBodyId: "void-vrm",
    });

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("passes with minimal input (only vrm + actionNames)", () => {
    const result = validateVoidV2RuntimeGate({
      vrm: createMockVrm(),
      actionNames: allVoidActionNames(),
    });

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("fails when a required bone is missing", () => {
    const result = validateVoidV2RuntimeGate({
      vrm: createMockVrm({ bones: { head: null } }),
      actionNames: allVoidActionNames(),
    });

    expect(result.passed).toBe(false);
    expect(
      result.issues.some(
        (i) => i.code === "BONE_MISSING" && i.message.includes("head"),
      ),
    ).toBe(true);
  });

  it("fails when vrm.lookAt is active (target set + autoUpdate on)", () => {
    const result = validateVoidV2RuntimeGate({
      vrm: createMockVrm({
        lookAtTarget: new THREE.Object3D(),
        lookAtAutoUpdate: true,
      }),
      actionNames: allVoidActionNames(),
    });

    expect(result.passed).toBe(false);
    expect(
      result.issues.some((i) => i.code === "LOOKAT_TARGET_ACTIVE"),
    ).toBe(true);
    expect(
      result.issues.some((i) => i.code === "LOOKAT_AUTOUPDATE_ENABLED"),
    ).toBe(true);
  });

  it("fails when a VOID motion action is not registered", () => {
    const partial = allVoidActionNames().filter((n) => n !== "GREET");
    const result = validateVoidV2RuntimeGate({
      vrm: createMockVrm(),
      actionNames: partial,
    });

    expect(result.passed).toBe(false);
    expect(
      result.issues.some(
        (i) =>
          i.code === "ACTION_NOT_REGISTERED" && i.message.includes("GREET"),
      ),
    ).toBe(true);
  });

  it("fails when productBodyIds contains a legacy body", () => {
    const result = validateVoidV2RuntimeGate({
      vrm: createMockVrm(),
      actionNames: allVoidActionNames(),
      productBodyIds: ["void-vrm", "bag-character"],
    });

    expect(result.passed).toBe(false);
    expect(
      result.issues.some(
        (i) =>
          i.code === "LEGACY_BODY_VISIBLE" &&
          i.message.includes("bag-character"),
      ),
    ).toBe(true);
  });

  it("assertVoidV2RuntimeGate throws on failing input", () => {
    expect(() =>
      assertVoidV2RuntimeGate({
        vrm: createMockVrm({ bones: { head: null } }),
        actionNames: allVoidActionNames(),
      }),
    ).toThrow();
  });

  it("formatVoidV2GateResult produces readable output with issue codes", () => {
    const result = validateVoidV2RuntimeGate({
      vrm: createMockVrm({ bones: { head: null, neck: null } }),
      actionNames: allVoidActionNames().filter((n) => n !== "PEEK"),
    });

    const formatted = formatVoidV2GateResult(result);

    expect(formatted).toContain("FAILED");
    expect(formatted).toContain("BONE_MISSING");
    expect(formatted).toContain("ACTION_NOT_REGISTERED");
    expect(formatted).toContain("PEEK");
  });
});
