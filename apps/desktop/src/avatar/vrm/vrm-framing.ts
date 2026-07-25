import * as THREE from "three";

export interface VrmFrameTransform {
  scale: number;
  position: [number, number, number];
}

function isRenderableMesh(
  object: THREE.Object3D,
): object is THREE.Mesh | THREE.SkinnedMesh {
  const maybe = object as Partial<THREE.Mesh>;

  return (
    object.visible !== false &&
    Boolean(maybe.isMesh || (object as Partial<THREE.SkinnedMesh>).isSkinnedMesh) &&
    Boolean(maybe.geometry)
  );
}

/**
 * 只按可见 SkinnedMesh / Mesh 算包围盒，忽略 SpringBone 空节点、
 * collider、隐藏节点，避免整 scene Box3 把视野撑大导致模型显得过小。
 * 返回把模型中心移到原点、并缩放到 fitHeight 世界高度的 transform。
 */
export function calculateVisibleMeshFrame(
  root: THREE.Object3D,
  fitHeight: number,
): VrmFrameTransform {
  root.updateMatrixWorld(true);

  const box = new THREE.Box3();
  let hasMesh = false;

  root.traverse((object) => {
    if (!isRenderableMesh(object)) return;

    const geometry = object.geometry;

    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }

    const localBox = geometry.boundingBox;

    if (!localBox) return;

    const worldBox = localBox.clone();
    worldBox.applyMatrix4(object.matrixWorld);

    if (!Number.isFinite(worldBox.min.x)) return;
    if (!Number.isFinite(worldBox.max.x)) return;

    box.union(worldBox);
    hasMesh = true;
  });

  if (!hasMesh || box.isEmpty()) {
    return {
      scale: 1,
      position: [0, -1.0, 0],
    };
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const height = Math.max(size.y, 0.001);
  const scale = fitHeight / height;

  return {
    scale,
    position: [-center.x * scale, -center.y * scale, -center.z * scale],
  };
}
