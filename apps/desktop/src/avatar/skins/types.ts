import type { Mood } from "@avatar-os/primitives";
import type { VisualFrame } from "../../renderer/visual-transform";

/** 皮肤统一入参（3d-rigged：gaze 走 gazeBus 共享 ref，不进这里以免触发重渲染）。 */
export interface SkinProps {
  mood: Mood;
}

/**
 * 皮肤统一入参（3d-skin：按真实代码结构定义）。
 * - mood:    来自 EventBus STATE_MOOD_CHANGED（AvatarFSM 的情绪枚举）
 * - motion:  来自 EventBus STATE_MOTION_CHANGED（动作状态字符串）
 * - frame:   来自 Avatar 的 120ms gesture tick（视线偏移 / 肢体角 / 头部倾斜 / 浮动）
 * - eyeOpenRatio: 来自 Morphology STATE_RENDER_PARAMS_CHANGED
 */
export interface AvatarSkinProps {
  mood: Mood;
  motion: string;
  frame: VisualFrame;
  eyeOpenRatio: number;
}
