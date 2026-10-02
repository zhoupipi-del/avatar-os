/**
 * 根运动过滤 — 过滤 hips 骨骼的 position 轨道，使动作原地播放
 *
 * 桌面角色固定在窗口中心，不允许 VRMA 的根运动把身体带离原位。
 * 保留 hips 的 rotation 轨道（躯干倾斜/扭转是有效表情）。
 */

import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

/**
 * 返回一个新 AnimationClip，其中 hips bone 的 position 轨道已被移除
 *
 * 若目标 VRM 没有 hips 骨骼（异常情况），返回源 clip 的浅拷贝。
 */
export function makeClipInPlace(
  source: THREE.AnimationClip,
  vrm: VRM,
): THREE.AnimationClip {
  const hips = vrm.humanoid.getNormalizedBoneNode("hips");

  if (!hips) {
    return source.clone();
  }

  const tracks = source.tracks.filter((track) => {
    try {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);

      const targetsHips =
        parsed.nodeName === hips.name || parsed.nodeName === hips.uuid;

      const targetsPosition = parsed.propertyName === "position";

      return !(targetsHips && targetsPosition);
    } catch {
      return true;
    }
  });

  return new THREE.AnimationClip(
    source.name,
    source.duration,
    tracks.map((track) => track.clone()),
    source.blendMode,
  );
}
