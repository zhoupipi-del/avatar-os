import React, { useId } from "react";
import { Mood } from "@avatar-os/primitives";
import { Eyes } from "./Eyes";
import { Mouth } from "./Mouth";
import { Particles } from "./Particles";
import { Arms } from "./Arms";
import { Legs } from "./Legs";
import { VisualFrame } from "../../renderer/visual-transform";

interface BodyProps {
  mood: Mood;
  motion: string;
  frame: VisualFrame;
  eyeOpenRatio?: number;
}

/**
 * 躯体装配层：把协议层(Mood)、动作层(motion)、视觉层(frame)合成为一棵 SVG 树。
 * 通过 useId 防止多 Avatar 实例的 <radialGradient> id 冲突。
 */
export const Body: React.FC<BodyProps> = ({ mood, motion, frame, eyeOpenRatio = 1 }) => {
  const rawId = useId();
  const bodyGradId = `bodyGrad-${rawId.replace(/:/g, "")}`;
  const happyGradId = `happyGrad-${rawId.replace(/:/g, "")}`;

  const isHappy =
    mood === Mood.HAPPY || mood === Mood.PLAYFUL || mood === Mood.EXCITED;
  const motionClass = motion ? `motion-${motion.toLowerCase()}` : "";

  // 随机行为树驱动的整体倾斜/浮动，与 bodyScale 同组叠加(不覆盖呼吸 CSS)
  const headTilt = frame.headTilt ?? 0;
  const bodyBob = frame.bodyBob ?? 0;

  return (
    <svg
      viewBox="0 0 120 155"
      className={`avatar-svg mood-${mood.toLowerCase()} ${motionClass}`}
    >
      <defs>
        <radialGradient id={bodyGradId} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="50%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#4f46e5" />
        </radialGradient>
        <radialGradient id={happyGradId} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="50%" stopColor="#f472b6" />
          <stop offset="100%" stopColor="#db2777" />
        </radialGradient>
      </defs>

      <g
        className="body-scale"
        style={{
          transform: `translateY(${bodyBob}px) rotate(${headTilt}deg) scale(${frame.bodyScale})`,
        }}
      >
        <circle
          cx="60"
          cy="60"
          r="50"
          fill={isHappy ? `url(#${happyGradId})` : `url(#${bodyGradId})`}
          className="avatar-body-circle"
        />
        <Arms
          mood={mood}
          motion={motion}
          angleL={frame.limbAngles?.armL ?? 0}
          angleR={frame.limbAngles?.armR ?? 0}
        />
        <Legs
          mood={mood}
          motion={motion}
          angleL={frame.limbAngles?.legL ?? 0}
          angleR={frame.limbAngles?.legR ?? 0}
        />
        <Eyes mood={mood} offset={frame.eyeOffset} openRatio={eyeOpenRatio} />
        <Mouth mood={mood} />
        <Particles mood={mood} />
      </g>
    </svg>
  );
};
