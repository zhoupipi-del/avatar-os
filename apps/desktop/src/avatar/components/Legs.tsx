import React from "react";
import { Mood } from "@avatar-os/primitives";

interface LegsProps {
  mood: Mood;
  motion: string;
  /** 实时输入驱动的左/右髋旋转角(度)。与 CSS motion 类(外层 <g>)嵌套共存 */
  angleL?: number;
  angleR?: number;
}

/**
 * 双腿模块。每只腿 = 外层 <g>(CSS motion 类) + 内层 <g>(实时输入旋转,
 * transform-origin=髋关节)。布娃娃拖拽时双腿晃动由此内层旋转驱动。
 */
export const Legs: React.FC<LegsProps> = ({ mood, motion, angleL = 0, angleR = 0 }) => {
  const motionKey = motion.toLowerCase();
  const limbClass = `limb-${motionKey}`;

  const isHappy =
    mood === Mood.HAPPY || mood === Mood.PLAYFUL || mood === Mood.EXCITED;
  const isSleeping = mood === Mood.SLEEPING;
  const isTired = mood === Mood.TIRED;

  const legColor = isHappy ? "#f472b6" : "#6366f1";
  const footColor = isHappy ? "#f9a8d4" : "#818cf8";

  const sleepStyleL = isSleeping || isTired
    ? { transform: "rotate(8deg) translateY(4px)", transition: "transform 2s ease" }
    : undefined;
  const sleepStyleR = isSleeping || isTired
    ? { transform: "rotate(-8deg) translateY(4px)", transition: "transform 2s ease" }
    : undefined;

  return (
    <g className="avatar-legs-layer">
      {/* 左腿：外层 motion 类 + 内层实时输入旋转 */}
      <g className={`leg-left ${limbClass}`} style={sleepStyleL}>
        <g
          style={{
            transformOrigin: "42px 106px",
            transform: `rotate(${angleL}deg)`,
            transition: "transform 0.12s ease-out",
          }}
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
      </g>

      {/* 右腿 */}
      <g className={`leg-right ${limbClass}`} style={sleepStyleR}>
        <g
          style={{
            transformOrigin: "78px 106px",
            transform: `rotate(${angleR}deg)`,
            transition: "transform 0.12s ease-out",
          }}
        >
          <path
            d="M 78,106 Q 80,122 80,138"
            fill="none"
            stroke={legColor}
            strokeWidth="8"
            strokeLinecap="round"
          />
          <ellipse cx="80" cy="140" rx="7" ry="5" fill={footColor} />
        </g>
      </g>
    </g>
  );
};
