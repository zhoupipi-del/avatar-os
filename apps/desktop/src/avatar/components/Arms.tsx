import React from "react";
import { Mood } from "@avatar-os/primitives";

interface ArmsProps {
  mood: Mood;
  motion: string;
  /** 实时输入驱动的左/右肩旋转角(度)。与 CSS motion 类(外层 <g>)嵌套共存，互不覆盖 */
  angleL?: number;
  angleR?: number;
}

/**
 * 双臂模块。每只手臂 = 外层 <g>(CSS motion 类, 绕肩关节呼吸/挥舞)
 * + 内层 <g>(实时输入旋转, transform-origin=肩关节)。两层嵌套叠加，
 * 因此"环境微动作"与"鼠标引力/打字/拖拽"可同时存在。
 */
export const Arms: React.FC<ArmsProps> = ({ mood, motion, angleL = 0, angleR = 0 }) => {
  const motionKey = motion.toLowerCase();
  const limbClass = `limb-${motionKey}`;

  const isHappy =
    mood === Mood.HAPPY || mood === Mood.PLAYFUL || mood === Mood.EXCITED;
  const isSleeping = mood === Mood.SLEEPING;
  const isTired = mood === Mood.TIRED;

  // 手臂颜色：开心态偏暖粉，其他统一靛蓝
  const armColor = isHappy ? "#f472b6" : "#6366f1";
  const handColor = isHappy ? "#f9a8d4" : "#818cf8";

  const sleepStyleL = isSleeping || isTired
    ? { transform: "rotate(18deg) translateY(6px)", transition: "transform 2s ease" }
    : undefined;
  const sleepStyleR = isSleeping || isTired
    ? { transform: "rotate(-18deg) translateY(6px)", transition: "transform 2s ease" }
    : undefined;

  return (
    <g className="avatar-arms-layer">
      {/* 左臂：外层 motion 类 + 内层实时输入旋转 */}
      <g className={`arm-left ${limbClass}`} style={sleepStyleL}>
        <g
          style={{
            transformOrigin: "22px 48px",
            transform: `rotate(${angleL}deg)`,
            transition: "transform 0.12s ease-out",
          }}
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
      </g>

      {/* 右臂 */}
      <g className={`arm-right ${limbClass}`} style={sleepStyleR}>
        <g
          style={{
            transformOrigin: "98px 48px",
            transform: `rotate(${angleR}deg)`,
            transition: "transform 0.12s ease-out",
          }}
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
    </g>
  );
};
