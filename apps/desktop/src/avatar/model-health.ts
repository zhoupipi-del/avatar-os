/**
 * model-health —— 导入模型的「体检单」：给不懂 3D 的人看的结论，而不是技术细节
 */
import type { VRM } from "@pixiv/three-vrm";
import type { SynthReport } from "./vrm/expression-synth";

/** 走路 / 动作 / 视线必须的骨骼（VRM 规范的必需骨骼） */
export const REQUIRED_BONES = [
  "hips", "spine", "head",
  "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
] as const;

export type Level = "ok" | "auto" | "missing";

export interface ModelHealthItem {
  readonly label: string;
  readonly level: Level;
  readonly detail: string;
}

export interface ModelHealth {
  /** 能不能用（骨骼齐全才能用；表情缺失只影响效果） */
  readonly usable: boolean;
  readonly items: ModelHealthItem[];
}

export function inspectModel(
  vrm: Pick<VRM, "humanoid">,
  synth: SynthReport,
): ModelHealth {
  const missingBones = REQUIRED_BONES.filter((b) => !vrm.humanoid?.getNormalizedBoneNode(b));
  const has = (n: string) => synth.native.includes(n as never) ? "native" : synth.synthesized.includes(n as never) ? "auto" : "missing";
  const level = (names: string[]): Level => {
    const states = names.map(has);
    if (states.every((s) => s === "native")) return "ok";
    if (states.every((s) => s !== "missing")) return "auto";
    return "missing";
  };
  const lips = ["aa", "ih", "ou", "ee", "oh"];
  const lipCount = lips.filter((n) => has(n) !== "missing").length;
  const emotions = ["happy", "sad", "angry", "relaxed", "surprised"];
  const emoCount = emotions.filter((n) => has(n) !== "missing").length;

  const items: ModelHealthItem[] = [
    {
      label: "身体骨骼",
      level: missingBones.length === 0 ? "ok" : "missing",
      detail: missingBones.length === 0 ? "齐全，能走路、做动作、看鼠标" : `缺少 ${missingBones.join("、")}，这个模型用不了`,
    },
    {
      label: "眨眼",
      level: level(["blink"]),
      detail: has("blink") === "missing" ? "模型没有眨眼表情，不会眨眼" : has("blink") === "auto" ? "已从面部变形自动生成" : "正常",
    },
    {
      label: "说话口型",
      level: lipCount === 5 ? level(lips) : lipCount > 0 ? "auto" : "missing",
      detail: lipCount === 0 ? "模型没有口型，说话时嘴不会动" : lipCount < 5 ? `只有 ${lipCount}/5 个口型，嘴会动但不太自然` : level(lips) === "auto" ? "已从面部变形自动生成" : "正常",
    },
    {
      label: "表情",
      level: emoCount === 5 ? level(emotions) : emoCount > 0 ? "auto" : "missing",
      detail: emoCount === 0 ? "没有喜怒哀乐表情，脸会一直是同一个表情" : emoCount < 5 ? `有 ${emoCount}/5 种表情` : level(emotions) === "auto" ? "已从面部变形自动生成" : "正常",
    },
  ];
  return { usable: missingBones.length === 0, items };
}
