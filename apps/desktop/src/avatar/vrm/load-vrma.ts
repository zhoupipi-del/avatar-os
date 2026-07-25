/**
 * VRMA 加载器 — 用 @pixiv/three-vrm-animation 加载 .vrma 动作文件
 *
 * 核心流程:
 *   GLTFLoader.register(VRMAnimationLoaderPlugin) → loadAsync → vrmAnimations[0]
 *   → createVRMAnimationClip(vrmAnimation, vrm) 重定向到目标 VRM 骨骼
 *   → 可选 makeClipInPlace 过滤 hips.position（桌面固定窗口模式）
 *
 * 同一 VRMA 可重定向到不同标准 VRM 身体。
 * 参考: https://pixiv.github.io/three-vrm/docs/functions/three-vrm-animation.createVRMAnimationClip
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import {
  VRMAnimation,
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";

import { makeClipInPlace } from "./root-motion";

/** 单个 VRMA 加载结果 */
export interface LoadedVrmActions {
  readonly mixer: THREE.AnimationMixer;
  /** 语义名 → AnimationAction */
  readonly actions: Record<string, THREE.AnimationAction>;
  /** 语义名 → AnimationClip（原始+处理后） */
  readonly clips: Record<string, THREE.AnimationClip>;
}

async function loadVrmAnimation(url: string): Promise<VRMAnimation> {
  const loader = new GLTFLoader();

  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

  const gltf = await loader.loadAsync(url);

  const animations = gltf.userData.vrmAnimations as
    | VRMAnimation[]
    | undefined;

  const animation = animations?.[0];

  if (!animation) {
    throw new Error(`[VOID] No VRM animation found: ${url}`);
  }

  return animation;
}

/**
 * 批量加载 VRMA 动作并重定向到目标 VRM
 *
 * @param vrm - 目标 VRM 实例（用于骨骼重定向）
 * @param urls - 语义名 → VRMA 文件路径映射
 * @param rootMotionMode - "in-place" 过滤 hips.position / "preserve" 保留根运动
 */
export async function loadVrmActions(
  vrm: VRM,
  urls: Readonly<Record<string, string>>,
  rootMotionMode: "in-place" | "preserve",
): Promise<LoadedVrmActions> {
  const mixer = new THREE.AnimationMixer(vrm.scene);

  const actions: Record<string, THREE.AnimationAction> = {};
  const clips: Record<string, THREE.AnimationClip> = {};

  await Promise.all(
    Object.entries(urls).map(async ([semanticName, url]) => {
      const source = await loadVrmAnimation(url);

      let clip = createVRMAnimationClip(source, vrm);
      clip.name = semanticName;

      if (rootMotionMode === "in-place") {
        clip = makeClipInPlace(clip, vrm);
        clip.name = semanticName;
      }

      clips[semanticName] = clip;
      actions[semanticName] = mixer.clipAction(clip);
    }),
  );

  return { mixer, actions, clips };
}
