/**
 * 视觉变换计算器（纯函数，无 React 依赖）。
 * 输入鼠标相对中心的位移/距离，输出视线偏移与近场缩放。
 * 这是「渲染层」的数学，与生命状态无关——UI 只表现，不决定。
 */
import type { LimbAngles } from "@avatar-os/morphology";

export interface VisualFrame {
  eyeOffset: { x: number; y: number };
  bodyScale: number;
  /** 实时输入驱动的肢体关节角(度)，与 CSS motion 类嵌套共存 */
  limbAngles?: LimbAngles;
}

const MAX_EYE_SHIFT = 8;
const NEAR_THRESHOLD = 100;

export function calculateFrame(
  dx: number,
  dy: number,
  distance: number,
): VisualFrame {
  const angle = Math.atan2(dy, dx);
  const shift = Math.min(distance / 20, MAX_EYE_SHIFT);

  return {
    eyeOffset: {
      x: Math.cos(angle) * shift,
      y: Math.sin(angle) * shift,
    },
    bodyScale: distance < NEAR_THRESHOLD ? 1.08 : 1.0,
  };
}
