import React from "react";
import { Body } from "../components/Body";
import type { AvatarSkinProps } from "./types";

/**
 * 经典 2D SVG 皮肤：直接包装现有 Body 组件。
 * 作为可回退皮肤保留——3D 皮肤出问题或想怀旧时切换回它。
 */
export const Classic2DSkin: React.FC<AvatarSkinProps> = ({
  mood,
  motion,
  frame,
  eyeOpenRatio,
}) => {
  return (
    <Body mood={mood} motion={motion} frame={frame} eyeOpenRatio={eyeOpenRatio} />
  );
};
