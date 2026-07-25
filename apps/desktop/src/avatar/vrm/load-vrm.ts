/**
 * VRM 加载器 — 用 @pixiv/three-vrm 的 VRMLoaderPlugin 加载 .vrm 文件
 *
 * 标准流程:
 *   GLTFLoader.register(VRMLoaderPlugin) → loadAsync → gltf.userData.vrm
 *
 * 参考: https://github.com/pixiv/three-vrm
 */

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

/**
 * 从 URL 加载 VRM 模型
 *
 * @param url - 公共目录下的 .vrm 路径（如 "/avatars/void/avatar.vrm"）
 * @returns 已配置好的 VRM 实例
 * @throws 若文件不含 VRM payload
 */
export async function loadVrm(url: string): Promise<VRM> {
  const loader = new GLTFLoader();

  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await loader.loadAsync(url);

  const vrm = gltf.userData.vrm as VRM | undefined;

  if (!vrm) {
    throw new Error(`[VOID] File does not contain a VRM payload: ${url}`);
  }

  // 命名 + 渲染优化
  vrm.scene.name = "VOID";
  vrm.scene.frustumCulled = false;

  vrm.scene.traverse((object) => {
    object.frustumCulled = false;

    if ("castShadow" in object) {
      (object as unknown as { castShadow: boolean }).castShadow = true;
    }

    if ("receiveShadow" in object) {
      (object as unknown as { receiveShadow: boolean }).receiveShadow = true;
    }
  });

  vrm.scene.updateMatrixWorld(true);

  return vrm;
}

/**
 * 彻底释放 VRM 资源（切换/卸载时调用）
 */
export function disposeVrm(vrm: VRM): void {
  VRMUtils.deepDispose(vrm.scene);
}
