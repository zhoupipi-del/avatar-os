import React from "react";
import { Mood } from "@avatar-os/primitives";
import { Particles } from "./Particles";
import { VisualFrame } from "../../renderer/visual-transform";

// 立绘资源：由参考图生成的 2D 扁平风格人物
// （黑卷发 / 圆黑眼镜 / 腮红微笑 / 黑底红图案 T 恤 / 迷彩短裤 / 灰运动鞋）
const CHARACTER_IMG = "/avatar-character.png";

interface BodyProps {
  mood: Mood;
  motion: string;
  frame: VisualFrame;
}

/**
 * 躯体装配层：把协议层(Mood)、动作层(motion)、视觉层(frame)合成为一棵 SVG 树。
 *
 * 现以 2D 立绘(/avatar-character.png)为人物主体，保留已落地的 limbs 能力：
 *  - 呼吸 / 开心弹跳(mood class) + 自主微动作(motion class) → 整体 SVG CSS 动画
 *  - 随机行为树 headTilt/bodyBob → body-scale 组的倾斜/浮动（在呼吸动画之上叠加）
 *  - limb-kinematics 合成的肢体角 → 整体倾靠/摇摆（静态立绘无法分肢，故把臂/腿角
 *    映射为整体微动；composeLimbAngles 仍是数据来源，鼠标引力够指、拖拽布娃娃、
 *    系统欢呼均可见）
 *  - 视线偏移 eyeOffset → 整体随光标轻移（鼠标引力继续生效）
 *  - Particles 开心态粒子
 * 想法气泡 / 状态气泡由 ThoughtBubble 在 Avatar 层独立渲染，不受影响。
 */
export const Body: React.FC<BodyProps> = ({ mood, motion, frame }) => {
  const isHappy =
    mood === Mood.HAPPY || mood === Mood.PLAYFUL || mood === Mood.EXCITED;
  const motionClass = motion ? `motion-${motion.toLowerCase()}` : "";

  // 随机行为树驱动的整体倾斜/浮动
  const headTilt = frame.headTilt ?? 0;
  const bodyBob = frame.bodyBob ?? 0;

  // 静态立绘无法分肢运动，把肢体角合成为整体微动，让 limb-kinematics 仍可见：
  // 双臂均值 → 向光标倾靠；双腿差 → 左右摇摆
  const la = frame.limbAngles;
  const reachLean = la ? (la.armL + la.armR) / 2 : 0;
  const sway = la ? (la.legL - la.legR) / 2 : 0;
  // 鼠标引力：视线偏移驱动整体轻移
  const gazeX = frame.eyeOffset?.x ?? 0;
  const gazeY = frame.eyeOffset?.y ?? 0;

  return (
    <svg
      viewBox="0 0 120 155"
      className={`avatar-svg mood-${mood.toLowerCase()} ${motionClass}`}
    >
      <g
        className="body-scale"
        style={{
          transform: `translate(${gazeX * 0.55}px, ${bodyBob + gazeY * 0.4}px) rotate(${headTilt + reachLean * 0.4}deg) skewX(${sway * 0.3}deg) scale(${frame.bodyScale})`,
          transformOrigin: "60px 92px",
        }}
      >
        <image
          href={CHARACTER_IMG}
          x="16"
          y="4"
          width="88"
          height="147"
          preserveAspectRatio="xMidYMid meet"
          style={{ pointerEvents: "none" }}
        />
        <Particles mood={mood} />
      </g>
    </svg>
  );
};
