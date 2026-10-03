import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { VRMExpression, VRMExpressionManager, VRMExpressionMorphTargetBind, type VRM } from "@pixiv/three-vrm";
import { normalizeMorphName, synthesizeMissingExpressions } from "./expression-synth";
import { inspectModel, REQUIRED_BONES } from "../model-health";

/** 造一个只有面部变形的"模型"：一个或多个网格，各带一组变形名 */
function fakeVrm(meshMorphs: string[][], manager?: VRMExpressionManager): { vrm: VRM; meshes: THREE.Mesh[] } {
  const scene = new THREE.Group();
  const meshes = meshMorphs.map((names) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    mesh.morphTargetDictionary = Object.fromEntries(names.map((n, i) => [n, i]));
    mesh.morphTargetInfluences = names.map(() => 0);
    scene.add(mesh);
    return mesh;
  });
  const vrm = { scene, expressionManager: manager } as unknown as VRM;
  return { vrm, meshes };
}

const influence = (mesh: THREE.Mesh, name: string) => mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]!]!;

const ARKIT = [
  "blendShape1.eyeBlinkLeft", "blendShape1.eyeBlinkRight", "blendShape1.jawOpen", "blendShape1.mouthFunnel",
  "blendShape1.mouthPucker", "blendShape1.mouthSmileLeft", "blendShape1.mouthSmileRight",
  "blendShape1.mouthFrownLeft", "blendShape1.mouthFrownRight", "blendShape1.browInnerUp",
  "blendShape1.browDownLeft", "blendShape1.browDownRight", "blendShape1.eyeWideLeft", "blendShape1.eyeWideRight",
];

describe("synthesizeMissingExpressions", () => {
  it("builds blink / lips / emotions from ARKit morphs so the mouth actually moves", () => {
    const { vrm, meshes } = fakeVrm([ARKIT]);
    const r = synthesizeMissingExpressions(vrm);
    expect(r.native).toEqual([]);
    expect(r.synthesized).toEqual(expect.arrayContaining(["blink", "aa", "ih", "ou", "ee", "oh", "happy", "sad", "angry", "relaxed", "surprised"]));
    expect(r.missing).toEqual([]);

    const m = vrm.expressionManager!;
    m.setValue("aa", 1);
    m.update();
    expect(influence(meshes[0]!, "blendShape1.jawOpen")).toBeCloseTo(0.7);

    m.setValue("aa", 0);
    m.setValue("blink", 1);
    m.update();
    expect(influence(meshes[0]!, "blendShape1.eyeBlinkLeft")).toBeCloseTo(1);
    expect(influence(meshes[0]!, "blendShape1.eyeBlinkRight")).toBeCloseTo(1);
    expect(influence(meshes[0]!, "blendShape1.jawOpen")).toBeCloseTo(0);
  });

  it("prefers dedicated viseme morphs over ARKit combinations", () => {
    const { vrm, meshes } = fakeVrm([["viseme_aa", "viseme_O", "jawOpen", "mouthFunnel"]]);
    synthesizeMissingExpressions(vrm);
    vrm.expressionManager!.setValue("aa", 1);
    vrm.expressionManager!.update();
    expect(influence(meshes[0]!, "viseme_aa")).toBeCloseTo(1);
    expect(influence(meshes[0]!, "jawOpen")).toBeCloseTo(0);
  });

  it("binds the same morph on every mesh that has it (face + teeth)", () => {
    const { vrm, meshes } = fakeVrm([["jawOpen"], ["jawOpen", "tongueOut"]]);
    synthesizeMissingExpressions(vrm);
    vrm.expressionManager!.setValue("aa", 1);
    vrm.expressionManager!.update();
    expect(influence(meshes[0]!, "jawOpen")).toBeCloseTo(0.7);
    expect(influence(meshes[1]!, "jawOpen")).toBeCloseTo(0.7);
  });

  it("never touches expressions the model already has", () => {
    const { vrm, meshes } = fakeVrm([["MyBlink", ...ARKIT]]);
    const manager = new VRMExpressionManager();
    const own = new VRMExpression("blink");
    own.addBind(new VRMExpressionMorphTargetBind({ primitives: [meshes[0]!], index: 0, weight: 1 }));
    manager.registerExpression(own);
    (vrm as unknown as { expressionManager: VRMExpressionManager }).expressionManager = manager;
    const r = synthesizeMissingExpressions(vrm);
    expect(r.native).toContain("blink");
    expect(r.synthesized).not.toContain("blink");
    expect(manager.getExpression("blink")).toBe(own);
  });

  it("replaces a preset that exists but is empty (common in hand-made VRMs)", () => {
    const manager = new VRMExpressionManager();
    manager.registerExpression(new VRMExpression("aa"));
    const { vrm } = fakeVrm([["jawOpen"]], manager);
    const r = synthesizeMissingExpressions(vrm);
    expect(r.synthesized).toContain("aa");
    expect(manager.getExpression("aa")!.binds.length).toBe(1);
  });

  it("reports what is impossible instead of faking it", () => {
    const { vrm } = fakeVrm([["Body_Shrink", "Hair_Wave"]]);
    const r = synthesizeMissingExpressions(vrm);
    expect(r.synthesized).toEqual([]);
    expect(r.missing).toContain("aa");
    expect(r.missing).toContain("blink");
  });

  it("normalizes morph names from different tools", () => {
    expect(normalizeMorphName("blendShape1.eyeBlink_L")).toBe("blendshape1eyeblinkl");
    expect(normalizeMorphName("ARKit_JawOpen")).toBe("arkitjawopen");
  });
});

describe("inspectModel", () => {
  const humanoid = (missing: string[] = []) => ({
    getNormalizedBoneNode: (b: string) => (missing.includes(b) ? null : new THREE.Object3D()),
  });

  it("explains in plain words what works", () => {
    const { vrm } = fakeVrm([ARKIT]);
    const synth = synthesizeMissingExpressions(vrm);
    const h = inspectModel({ humanoid: humanoid() } as never, synth);
    expect(h.usable).toBe(true);
    expect(h.items.map((i) => [i.label, i.level])).toEqual([
      ["身体骨骼", "ok"],
      ["眨眼", "auto"],
      ["说话口型", "auto"],
      ["表情", "auto"],
    ]);
  });

  it("rejects models without the bones needed to move", () => {
    const h = inspectModel({ humanoid: humanoid(["leftFoot"]) } as never, { native: [], synthesized: [], missing: [] });
    expect(h.usable).toBe(false);
    expect(h.items[0]!.detail).toContain("leftFoot");
    expect(REQUIRED_BONES).toContain("hips");
  });

  it("says plainly when the mouth will not move", () => {
    const { vrm } = fakeVrm([["Hair_Wave"]]);
    const h = inspectModel({ humanoid: humanoid() } as never, synthesizeMissingExpressions(vrm));
    expect(h.items.find((i) => i.label === "说话口型")!.detail).toContain("嘴不会动");
  });
});
