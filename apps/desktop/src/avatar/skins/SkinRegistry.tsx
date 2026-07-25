import { RiggedGLBSkin, BAG_CONFIG, ROBOT_CONFIG, type RigConfig } from "./RiggedGLBSkin";
import { StandardAvatarSkin } from "./StandardAvatarSkin";
import { VoidVrmSkin } from "./VoidVrmSkin";

export { RiggedGLBSkin, BAG_CONFIG, ROBOT_CONFIG };
export { StandardAvatarSkin };
export { VoidVrmSkin };
export type { RigConfig };

/** 当前 MVP 默认身体：bag-character（GLB） */
export const DEFAULT_SKIN = "bag-character" as const;

/**
 * 皮肤注册表 —— 以后换 VRM / Live2D / 机器人，只加一条配置，Agent 核心不动。
 *
 * V1 新增: void-vrm (VRM 格式，AvatarSample_Z)
 * 渲染层按 key 取配置喂给对应 Skin 组件。
 */
export const SKIN_REGISTRY: Record<string, RigConfig> = {
  "bag-character": BAG_CONFIG,
  "rigged-glb": ROBOT_CONFIG,
};

/**
 * 注（v0.3.4-A）：原 `MVPSkin = StandardMVPSkin` 别名已移除。
 * 它曾是隐式所有权落点——StandardMVPSkin 在 StandardAvatarSkin.tsx 内
 * 写死 `config={BAG_CONFIG}`，使"当前身体"由 UI 组件常量决定。
 * 现在 active 身体由 @avatar-os/runtime 的 AvatarService 持有，
 * 渲染层经 desktop 的 avatar-profiles 目录解析 config 下传，
 * 不再需要这个硬编码壳。StandardAvatarSkin 直接以 config prop 挂载。
 */
