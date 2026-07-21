import React from "react";
import type { AvatarSkinProps } from "./types";
import { Classic2DSkin } from "./Classic2DSkin";
import { MechaCore3DSkin } from "./MechaCore3DSkin";
import { Frieza3DSkin } from "./Frieza3DSkin";

/**
 * 换肤注册表：把不同渲染皮肤登记为可切换的组件。
 * 当前默认启用 Frieza 3D（基于你真下的 .glb，实现视觉降维打击）。
 * 控制台可热切换：window.__AVATAR_DEV__.setSkin('classic-2d' | 'mecha-core' | 'frieza-3d')
 */
export const SKIN_REGISTRY: Record<string, React.FC<AvatarSkinProps>> = {
  "classic-2d": Classic2DSkin,
  "mecha-core": MechaCore3DSkin,
  "frieza-3d": Frieza3DSkin,
};

export const CURRENT_SKIN_ID = "frieza-3d";

/** 运行时切换皮肤：派发 window 事件，Avatar 监听后重渲染 */
export function setSkin(id: string): boolean {
  if (!SKIN_REGISTRY[id]) return false;
  window.dispatchEvent(new CustomEvent("avatar-skin-change", { detail: id }));
  return true;
}
