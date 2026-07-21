import type { Mood } from "@avatar-os/primitives";

/** 皮肤统一入参。gaze 走 gazeBus 共享 ref，不进这里以免触发重渲染。 */
export interface SkinProps {
  mood: Mood;
}
