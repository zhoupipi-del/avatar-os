import { RiggedGLBSkin, BAG_CONFIG, ROBOT_CONFIG, type RigConfig } from "./RiggedGLBSkin";
import { BagCharacterSkin, BagCharacterMVPSkin } from "./BagCharacterSkin";

export { RiggedGLBSkin, BAG_CONFIG, ROBOT_CONFIG };
export { BagCharacterSkin, BagCharacterMVPSkin };
export type { RigConfig };

/** 当前 MVP 默认身体：bag character（真·骨骼 + 动作片段，无脸） */
export const DEFAULT_SKIN = "bag-character" as const;

/**
 * 皮肤注册表 —— 以后换 VRM / Live2D / 机器人，只加一条配置，Agent 核心不动。
 * 渲染层按 key 取 RigConfig 喂给 RiggedGLBSkin。
 */
export const SKIN_REGISTRY: Record<string, RigConfig> = {
  "bag-character": BAG_CONFIG,
  "rigged-glb": ROBOT_CONFIG,
};

/** MVP 身体组件：消费 bag-character 配置 + 彻底解耦的 Adapter 引擎 */
export const MVPSkin = BagCharacterMVPSkin;
