/**
 * VOID Avatar Profile — AvatarSample_Z.vrm (VRM 1.0)
 *
 * 唯一生产人物候选。VRoid Studio 2.14.0 导出。
 * 54 Humanoid 骨骼, 14 表情, LookAt + SpringBone(32组/117关节)。
 *
 * 路线: v0.3.7-V1 加载 → V2 接表情/眨眼/LookAt/SpringBone
 *       → V3 接 VRMA → V4 设为唯一 → V5 删旧身体
 */

import type { PhysicalIntentType } from "@avatar-os/primitives";

export type VoidActionName =
  | "IDLE"
  | "GREET"
  | "GREET_ALT"
  | "BOUNCE_HAPPY"
  | "PEEK"
  | "THINKING"
  | "HAPPY_IDLE"
  | "SAD_BODY"
  | PhysicalIntentType;

export interface VoidAvatarProfile {
  readonly id: "void-vrm";
  readonly displayName: "VOID";
  readonly format: "vrm";

  /** 公共目录下的 VRM 文件路径 */
  readonly modelUrl: string;

  /** 摄像机适配高度（场景单位） */
  readonly fitHeight: number;

  /** Y 轴旋转（弧度）。首轮不转；真机确认背对相机时改为 Math.PI */
  readonly rotationY: number;

  /** 根运动模式。桌面角色固定窗口中心，默认 in-place */
  readonly rootMotionMode: "in-place" | "preserve";

  /** 语义名 → VRMA 文件路径映射。暂无动作时可为 {}，程序化降级 */
  readonly actions: Partial<Record<VoidActionName, string>>;
}

export const VOID_AVATAR_PROFILE: VoidAvatarProfile = {
  id: "void-vrm",
  displayName: "VOID",
  format: "vrm",

  modelUrl: "/avatars/void/avatar.vrm",
  // V1 取景修正：原 2.6（无 framing 时 VRM 按原始米级渲染显得过小）。
  // 接入 calculateVisibleMeshFrame 后 fitHeight = 目标世界高度。
  // 3.2 实测偏大(头脚贴边、气泡无空间)，按 BOSS 验收口径降到 2.4（占视口~76%）。
  fitHeight: 2.4,

  // AvatarSample_Z 是 VRM 1.0。首轮不额外旋转。
  rotationY: 0,

  rootMotionMode: "in-place",

  actions: {
    IDLE: "/avatars/void/animations/idle_normal.vrma",
    GREET: "/avatars/void/animations/standing_greeting.vrma",
    GREET_ALT: "/avatars/void/animations/wave.vrma",
    BOUNCE_HAPPY: "/avatars/void/animations/excited.vrma",
    PEEK: "/avatars/void/animations/look_around.vrma",
    THINKING: "/avatars/void/animations/thinking.vrma",
    HAPPY_IDLE: "/avatars/void/animations/happy_idle.vrma",
    SAD_BODY: "/avatars/void/animations/crying.vrma",

    // 暂无准确语义动作，不乱绑：
    // STRETCH: undefined,
    // DOZE: undefined,
  },
};
