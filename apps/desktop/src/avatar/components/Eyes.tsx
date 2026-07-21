import React from "react";
import { Mood } from "@avatar-os/primitives";

interface EyesProps {
  mood: Mood;
  offset: { x: number; y: number };
  /** 眼开合比 0.0(闭合) ~ 1.0(全开)，由 Morphology 经 STATE_RENDER_PARAMS_CHANGED 驱动 */
  openRatio?: number;
}

export const Eyes: React.FC<EyesProps> = ({ mood, offset, openRatio = 1 }) => {
  const open = Math.max(0, Math.min(1, openRatio));
  const closed = open <= 0.12;
  const ry = Math.max(1.5, 10 * open);
  const pupilCy = 52 - (10 - ry) * 0.2;

  return (
    <g className="avatar-eyes-layer" transform={`translate(${offset.x}, ${offset.y})`}>
      {closed ? (
        // 闭合：眼睑下垂弧线（沉睡/打盹）
        <>
          <path d="M 34 56 Q 42 64 50 56" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
          <path d="M 70 56 Q 78 64 86 56" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="42" cy="52" rx="7" ry={ry} fill="#ffffff" className="blink-eye" />
          <circle cx="43" cy={pupilCy} r="2.5" fill="#1e1b4b" />
          <ellipse cx="78" cy="52" rx="7" ry={ry} fill="#ffffff" className="blink-eye" />
          <circle cx="79" cy={pupilCy} r="2.5" fill="#1e1b4b" />
        </>
      )}
    </g>
  );
};
