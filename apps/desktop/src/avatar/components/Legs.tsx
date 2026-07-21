import React from "react";
import { Mood } from "@avatar-os/primitives";

interface LegsProps {
  mood: Mood;
  motion: string;
}

/**
 * 双腿模块。从身体底部伸出，配合 motion 驱动：
 * - BREATH: 呼吸微摆
 * - HAPPY_BOUNCE: 弹跳压缩
 * - STRETCH: 向下舒展
 * - DOZE: 松软无力
 */
export const Legs: React.FC<LegsProps> = ({ mood, motion }) => {
  const motionKey = motion.toLowerCase();
  const limbClass = `limb-${motionKey}`;

  const isHappy =
    mood === Mood.HAPPY || mood === Mood.PLAYFUL || mood === Mood.EXCITED;
  const isSleeping = mood === Mood.SLEEPING;
  const isTired = mood === Mood.TIRED;

  const legColor = isHappy ? "#f472b6" : "#6366f1";
  const footColor = isHappy ? "#f9a8d4" : "#818cf8";

  return (
    <g className="avatar-legs-layer">
      {/* 左腿 */}
      <g
        className={`leg-left ${limbClass}`}
        style={
          (isSleeping || isTired)
            ? { transform: "rotate(8deg) translateY(4px)", transition: "transform 2s ease" }
            : undefined
        }
      >
        <path
          d="M 42,106 Q 40,122 40,138"
          fill="none"
          stroke={legColor}
          strokeWidth="8"
          strokeLinecap="round"
        />
        <ellipse cx="40" cy="140" rx="7" ry="5" fill={footColor} />
      </g>

      {/* 右腿 */}
      <g
        className={`leg-right ${limbClass}`}
        style={
          (isSleeping || isTired)
            ? { transform: "rotate(-8deg) translateY(4px)", transition: "transform 2s ease" }
            : undefined
        }
      >
        <path
          d="M 78,106 Q 80,122 80,138"
          fill="none"
          stroke={legColor}
          strokeWidth="8"
          strokeLinecap="round"
        />
        <ellipse cx="80" cy="140" r="7" ry="5" fill={footColor} />
      </g>
    </g>
  );
};
