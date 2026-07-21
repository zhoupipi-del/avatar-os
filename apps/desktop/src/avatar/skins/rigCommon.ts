import * as THREE from "three";

/**
 * 自动取景：把模型包围盒居中，并按目标高度(fitHeight, 世界单位)整体缩放，
 * 这样相机固定 [0,0.3,5] fov35 即可稳定框住任意尺寸的模型，无需逐模型调相机。
 */
export function frameModel(scene: THREE.Object3D, fitHeight: number): void {
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = fitHeight / (size.y || 1);
  scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  scene.scale.setScalar(scale);
}

/** 按正则定位第一个匹配的骨骼/物体 */
export function findBone(scene: THREE.Object3D, matcher: RegExp): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  scene.traverse((o) => {
    if (!found && matcher.test(o.name)) found = o;
  });
  return found;
}

/** 按名字(精确/忽略大小写)定位骨骼/物体 */
export function findBoneByName(scene: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  const lower = name.toLowerCase();
  scene.traverse((o) => {
    if (!found && o.name.toLowerCase() === lower) found = o;
  });
  return found;
}
