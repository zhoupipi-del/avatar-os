import { RiggedGLBSkin, BAG_CONFIG, ROBOT_CONFIG, type RigConfig } from "./RiggedGLBSkin";

export { RiggedGLBSkin, BAG_CONFIG, ROBOT_CONFIG };
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
