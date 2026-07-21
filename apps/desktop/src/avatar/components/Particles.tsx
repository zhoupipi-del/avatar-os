import React from "react";
import { Mood } from "@avatar-os/primitives";

/**
 * 粒子层：仅在开心态(HAPPY/PLAYFUL/EXCITED)浮现，纯视觉点缀。
 * 不读取也不影响任何生命状态。
 */
export const Particles: React.FC<{ mood: Mood }> = ({ mood }) => {
  const active =
    mood === Mood.HAPPY || mood === Mood.PLAYFUL || mood === Mood.EXCITED;
  if (!active) return null;

  return (
    <g className="avatar-particles">
      {[0, 1, 2, 3, 4].map((i) => (
        <circle
          key={i}
          cx={28 + i * 16}
          cy={22}
          r={2}
          fill="#fde68a"
          className="particle"
        />
      ))}
    </g>
  );
};
