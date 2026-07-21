import React from "react";
import { Mood } from "@avatar-os/primitives";

interface ArmsProps {
  mood: Mood;
  motion: string;
}

/**
 * 双臂模块。两只手臂从身体侧面伸出，随 motion 驱动微动作：
 * - BREATH: 呼吸微摆
 * - STRETCH: 向上舒展
 * - HAPPY_BOUNCE: 开心挥舞
 * - DOZE: 松垂打盹
 * - CURIOUS/FOCUSED: 好奇微抬
 *
 * 每个手臂使用独立的 <g> + transform-origin 在肩关节处旋转，
 * avoid 与 body breathing scale 叠加冲突。
 */
export const Arms: React.FC<ArmsProps> = ({ mood, motion }) => {
  const motionKey = motion.toLowerCase();
  const limbClass = `limb-${motionKey}`;

  const isHappy =
    mood === Mood.HAPPY || mood === Mood.PLAYFUL || mood === Mood.EXCITED;
  const isSleeping = mood === Mood.SLEEPING;
  const isTired = mood === Mood.TIRED;

  // 手臂颜色：开心态偏暖粉，其他统一靛蓝
  const armColor = isHappy ? "#f472b6" : "#6366f1";
  const handColor = isHappy ? "#f9a8d4" : "#818cf8";

  return (
    <g className="avatar-arms-layer">
      {/* 左臂 */}
      <g
        className={`arm-left ${limbClass}`}
        style={
          (isSleeping || isTired)
            ? { transform: "rotate(18deg) translateY(6px)", transition: "transform 2s ease" }
            : undefined
        }
      >
        <path
          d="M 22,48 Q 8,68 14,88"
          fill="none"
          stroke={armColor}
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle cx="14" cy="90" r="5" fill={handColor} />
      </g>

      {/* 右臂 */}
      <g
        className={`arm-right ${limbClass}`}
        style={
          (isSleeping || isTired)
            ? { transform: "rotate(-18deg) translateY(6px)", transition: "transform 2s ease" }
            : undefined
        }
      >
        <path
          d="M 98,48 Q 112,68 106,88"
          fill="none"
          stroke={armColor}
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle cx="106" cy="90" r="5" fill={handColor} />
      </g>
    </g>
  );
};
