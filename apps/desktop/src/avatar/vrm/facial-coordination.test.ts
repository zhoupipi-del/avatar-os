import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  VRMExpression,
  VRMExpressionManager,
  VRMExpressionMorphTargetBind,
} from "@pixiv/three-vrm";
import { coordinateFacialWeights } from "./facial-coordination";

function setup() {
  const manager = new VRMExpressionManager();
  const mesh = new THREE.Mesh();
  mesh.morphTargetInfluences = [0, 0, 0];
  const add = (name: string, index: number, weight: number) => {
    const expression = new VRMExpression(name);
    expression.addBind(
      new VRMExpressionMorphTargetBind({
        primitives: [mesh],
        index,
        weight: 1,
      }),
    );
    manager.registerExpression(expression);
    manager.setValue(name, weight);
    return expression;
  };
  return { manager, mesh, add };
}

describe("facial coordination", () => {
  it("reserves shared morphs for speech without progressively attenuating emotion", () => {
    const { manager, mesh, add } = setup();
    add("aa", 0, 0.7);
    add("happy", 0, 0.8);
    for (let i = 0; i < 5; i++) {
      coordinateFacialWeights(manager, { happy: 0.8 });
      expect(manager.getValue("happy")).toBeCloseTo(0.3);
      expect(manager.getValue("aa")).toBe(0.7);
      manager.update();
      expect(mesh.morphTargetInfluences![0]).toBeCloseTo(1);
    }
    manager.setValue("aa", 0);
    coordinateFacialWeights(manager, { happy: 0.8 });
    expect(manager.getValue("happy")).toBe(0.8);
  });

  it("budgets crossfading emotions together and reserves shared eyelids for blink", () => {
    const { manager, add } = setup();
    add("blink", 0, 0.8);
    add("happy", 0, 0.5);
    add("sad", 0, 0.5);
    coordinateFacialWeights(manager, { happy: 0.5, sad: 0.5 });
    expect(manager.getValue("happy")).toBeCloseTo(0.1);
    expect(manager.getValue("sad")).toBeCloseTo(0.1);
  });

  it("keeps unrelated morphs unchanged", () => {
    const { manager, add } = setup();
    add("aa", 0, 1);
    add("happy", 1, 0.6);
    coordinateFacialWeights(manager, { happy: 0.6 });
    expect(manager.getValue("happy")).toBe(0.6);
  });

  it("does not let a binary emotion exceed a partial shared-morph budget", () => {
    const { manager, mesh, add } = setup();
    add("aa", 0, 0.3);
    const happy = add("happy", 0, 0.9);
    happy.isBinary = true;
    coordinateFacialWeights(manager, { happy: 0.9 });
    manager.update();
    expect(mesh.morphTargetInfluences![0]).toBeCloseTo(0.3);
    manager.setValue("aa", 0);
    coordinateFacialWeights(manager, { happy: 0.9 });
    manager.update();
    expect(mesh.morphTargetInfluences![0]).toBe(1);
  });

  it("lets native blend overrides apply exactly once", () => {
    const { manager, mesh, add } = setup();
    add("aa", 0, 0.8);
    const happy = add("happy", 1, 0.6);
    happy.overrideMouth = "blend";
    coordinateFacialWeights(manager, { happy: 0.6 });
    expect(manager.getValue("happy")).toBe(0.6);
    expect(manager.getValue("aa")).toBe(0.8);
    manager.update();
    expect(mesh.morphTargetInfluences![0]).toBeCloseTo(0.32);
  });
});
