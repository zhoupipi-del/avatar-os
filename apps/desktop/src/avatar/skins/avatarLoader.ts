import { useGLTF, useAnimations } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { AvatarCapabilities } from "@avatar-os/runtime";

export interface AvatarTransform {
  scale: number;
  position: [number, number, number];
}

export interface LoadedAvatar {
  scene: THREE.Object3D;
  actions: Record<string, THREE.AnimationAction>;
  mixer: THREE.AnimationMixer;
  capabilities: AvatarCapabilities;
  transform: AvatarTransform;
}

/**
 * 统一加载 + 归一化管线（GLB/VRM 通用）。
 * 洗澡(材质修复) / 称重(缩放) / 体检(能力探测) 都在底层完成，再交付渲染树。
 *
 * 设计取舍（对照网上的「直接 <primitive object={scene} />」炸模型翻车）：
 * - 尺寸/定位用「包裹 group 的 transform」，绝不 mutate 共享的 Drei 缓存 scene，
 *   也避免 scene.clone() 把 SkinnedMesh 的骨骼绑定打断（plain clone 会断 skeleton，
 *   动画直接不播）。group 缩放对蒙皮网格完全安全。
 * - 材质修复只做防御性只读遍历：opacity>=1 的强制关透明、开 depthWrite，
 *   防止半透明幽灵/深度排序错乱；绝不改几何与贴图。这是兜底，不是已确认 bug 的修复——
 *   真机是否绿/畸变得看窗口，loader 只保证「任意乱源模型都被压进标准件」。
 * - capabilities 是「面向能力编程」的核心数据：换任意 Mod 模型，系统先看它再定降级策略。
 */
export function useAvatarLoader(modelUrl: string, targetHeight = 2.0): LoadedAvatar {
  const { scene, animations } = useGLTF(modelUrl);
  const { actions, mixer } = useAnimations(animations, scene);

  const { capabilities, transform } = useMemo(() => {
    let hasSkeleton = false;
    let hasBlendShapes = false;
    const skeletonBoneNames: string[] = [];

    scene.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const mat = m as THREE.MeshStandardMaterial;
          // 原模型没开透明却带着透明标记 → 关掉，防止渲染管线深度排序错乱
          if (typeof mat.opacity === "number" && mat.opacity >= 1) {
            mat.transparent = false;
            mat.depthWrite = true;
          }
          mat.needsUpdate = true;
        }
        if (mesh.morphTargetDictionary) hasBlendShapes = true;
      }
      const bone = child as THREE.Bone;
      if (bone.isBone) {
        hasSkeleton = true;
        if (bone.name) skeletonBoneNames.push(bone.name);
      }
    });

    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // 以最长轴为基准对齐 targetHeight（站姿模型最长轴即身高，等同按 Y 缩放）
    const maxSize = Math.max(size.x, size.y, size.z) || 1;
    const scale = targetHeight / maxSize;
    // 居中：相机固定看向原点，故把几何中心对到 (0,0,0)，而不是脚底踩 Y=0
    // （脚底贴地会把模型整体压到画面下半部，相机取景会偏）
    const position: [number, number, number] = [
      -center.x * scale,
      -center.y * scale,
      -center.z * scale,
    ];

    const caps: AvatarCapabilities = {
      hasSkeleton,
      hasBlendShapes,
      availableAnimations: animations.map((a) => a.name),
      skeletonBoneNames,
    };
    return { capabilities: caps, transform: { scale, position } };
  }, [scene, animations, targetHeight]);

  // useAnimations 的 actions 类型允许 null（某些 clip 解析失败），交给 AnimationManager 前先剔除
  const cleanActions: Record<string, THREE.AnimationAction> = {};
  for (const name of Object.keys(actions)) {
    const a = actions[name];
    if (a) cleanActions[name] = a;
  }

  return { scene, actions: cleanActions, mixer, capabilities, transform };
}
