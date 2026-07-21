import { describe, it, expect } from "vitest";
import { EmbodimentRuntime, type AvatarLifeState, type PrimitiveBindings } from "../src/avatar-adapter/embodiment-runtime";
import type { AvatarCapabilities } from "../src/avatar-adapter/capabilities";
import { PhysicalPrimitive } from "@avatar-os/primitives";
import { NEUTRAL_EMOTIONAL_STATE } from "@avatar-os/primitives";

const baseBindings: PrimitiveBindings = {
  idleClip: "NlaTrack",
  intentClip: { GREET: "NlaTrack.001", BOUNCE_HAPPY: "NlaTrack.002" },
  statusClip: { success: "NlaTrack.002", error: "NlaTrack.001" },
  spineBone: "Spine01",
};

const bagCaps: AvatarCapabilities = {
  hasSkeleton: true,
  hasBlendShapes: false,
  availableAnimations: ["NlaTrack", "NlaTrack.001", "NlaTrack.002"],
  skeletonBoneNames: ["Spine01", "Head"],
  supportedBones: ["Spine01", "Head"],
  availableClips: [
    { name: "NlaTrack", duration: 4 },
    { name: "NlaTrack.001", duration: 2.58 },
    { name: "NlaTrack.002", duration: 12.79 },
  ],
  features: ["procedural_look_at", "prebaked_animation"],
  hasMaterialEmotion: false,
  availableBlendShapes: [],
};

const life = (energy = 1): AvatarLifeState => ({
  life: { energy, socialNeed: 0.2, curiosity: 0.5, pressures: { fatiguePressure: 0, lonelinessPressure: 0, curiosityPressure: 0 } },
  emotion: NEUTRAL_EMOTIONAL_STATE,
  presence: { userNearby: true, isFocused: false },
});

const rt = new EmbodimentRuntime();

describe("EmbodimentRuntime.compile — 候选链 fallback", () => {
  it("有挥手动画 → PLAY_ANIMATION(已知映射), 不降级", () => {
    const cmds = rt.compile("GREET", life(), baseBindings, bagCaps);
    const play = cmds.find((c) => c.type === PhysicalPrimitive.PLAY_ANIMATION);
    expect(play).toBeDefined();
    expect(play!.payload.clip).toBe("NlaTrack.001");
    // 气泡总在
    expect(cmds.some((c) => c.type === PhysicalPrimitive.SPEECH_BUBBLE)).toBe(true);
    // 未降级到倾斜
    expect(cmds.some((c) => c.type === PhysicalPrimitive.BODY_LEAN)).toBe(false);
  });

  it("片段名不在 availableAnimations → 降级到脊椎倾斜(BODY_LEAN)", () => {
    const bindings: PrimitiveBindings = {
      ...baseBindings,
      intentClip: { ...baseBindings.intentClip, GREET: "Wave" }, // 真实模型没有 "Wave"
    };
    const cmds = rt.compile("GREET", life(), bindings, bagCaps);
    expect(cmds.some((c) => c.type === PhysicalPrimitive.PLAY_ANIMATION)).toBe(false);
    const lean = cmds.find((c) => c.type === PhysicalPrimitive.BODY_LEAN);
    expect(lean).toBeDefined();
    expect(lean!.payload.bone).toBe("Spine01");
  });

  it("无脊椎骨 → 连倾斜都落空, 仅剩气泡(优雅降级到无动作)", () => {
    const caps: AvatarCapabilities = { ...bagCaps, supportedBones: [], hasSkeleton: false };
    const bindings: PrimitiveBindings = {
      ...baseBindings,
      intentClip: { ...baseBindings.intentClip, GREET: "Wave" },
    };
    const cmds = rt.compile("GREET", life(), bindings, caps);
    expect(cmds.some((c) => c.type === PhysicalPrimitive.PLAY_ANIMATION)).toBe(false);
    expect(cmds.some((c) => c.type === PhysicalPrimitive.BODY_LEAN)).toBe(false);
    expect(cmds.some((c) => c.type === PhysicalPrimitive.SPEECH_BUBBLE)).toBe(true);
  });

  it("有面部 BlendShape → BLENDSHAPE_SET, 不发光", () => {
    const caps: AvatarCapabilities = { ...bagCaps, hasBlendShapes: true, availableBlendShapes: ["Smile"] };
    const cmds = rt.compile("GREET", life(), baseBindings, caps);
    expect(cmds.some((c) => c.type === PhysicalPrimitive.BLENDSHAPE_SET)).toBe(true);
    expect(cmds.some((c) => c.type === PhysicalPrimitive.MATERIAL_GLOW)).toBe(false);
  });

  it("无脸但有材质情绪 → MATERIAL_GLOW 降级", () => {
    const caps: AvatarCapabilities = { ...bagCaps, hasMaterialEmotion: true };
    const cmds = rt.compile("GREET", life(), baseBindings, caps);
    expect(cmds.some((c) => c.type === PhysicalPrimitive.MATERIAL_GLOW)).toBe(true);
  });

  it("低能量 → 所有指令权重按能量衰减", () => {
    const cmds = rt.compile("GREET", life(0.1), baseBindings, bagCaps);
    const play = cmds.find((c) => c.type === PhysicalPrimitive.PLAY_ANIMATION);
    expect(play!.weight).toBeLessThan(1);
    expect(play!.weight).toBeCloseTo(0.1, 5);
  });
});
