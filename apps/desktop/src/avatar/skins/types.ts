import type { Mood } from "@avatar-os/primitives";
import type { VisualFrame } from "../../renderer/visual-transform";

/**
 * 皮肤统一入参（按真实代码结构定义，非计划里的虚构字段）。
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
