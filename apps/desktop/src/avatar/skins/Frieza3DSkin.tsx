import React, { useRef, useLayoutEffect, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  useGLTF,
  Float,
  Sparkles,
  Environment,
  Lightformer,
  ContactShadows,
} from "@react-three/drei";
import * as THREE from "three";
import type { AvatarSkinProps } from "./types";
import { moodColor } from "./moodColor";

// VisualFrame.eyeOffset 上限（visual-transform 的 MAX_EYE_SHIFT）
const GAZE_RANGE = 8;
const MODEL_URL = "/models/frieza.glb";

// --- Frieza 3D 模型驱动器（静态网格：整组跟随 + 情绪色光晕）---
const FriezaModel: React.FC<{
  mood: AvatarSkinProps["mood"];
  eyeOffset: { x: number; y: number };
}> = ({ mood, eyeOffset }) => {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, materials } = useGLTF(MODEL_URL) as unknown as {
    scene: THREE.Group;
    materials: Record<string, THREE.MeshStandardMaterial>;
  };

  // 居中并缩放到合适大小（静态网格，无骨骼，直接整体变换）
  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 3 / maxDim;
    scene.position.sub(center.multiplyScalar(scale));
    scene.scale.setScalar(scale);
  }, [scene]);

  useFrame(() => {
    if (!groupRef.current) return;

    // 1. 物理 IK 视线追踪：整组旋转死死盯住鼠标
    const gx = Math.max(-1, Math.min(1, (eyeOffset.x || 0) / GAZE_RANGE));
    const gy = Math.max(-1, Math.min(1, (eyeOffset.y || 0) / GAZE_RANGE));
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      gx * (Math.PI / 3),
      0.1,
    );
    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x,
      -gy * (Math.PI / 3),
      0.1,
    );

    // 2. 情绪色光晕：把材质 emissive 朝 mood 色平滑过渡（静态网格也能"变色"）
    const target = moodColor(mood);
    const mats = Object.values(materials);
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.emissive) {
        std.emissive.lerp(target, 0.05);
        std.emissiveIntensity = THREE.MathUtils.lerp(
          std.emissiveIntensity,
          0.35,
          0.05,
        );
      }
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
};

// --- 对外暴露的 3D 皮肤容器（加载真实 Frieza 模型）---
export const Frieza3DSkin: React.FC<AvatarSkinProps> = ({ mood, frame }) => {
  const eyeOffset = frame.eyeOffset;
  const sparkColor = moodColor(mood).getStyle();
  return (
    <Canvas
      className="skin-3d"
      camera={{ position: [0, 0.5, 6], fov: 45 }}
      gl={{ alpha: true, antialias: true }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={1.4} />
      {/* 情绪色点光源，强化光晕随 mood 渐变 */}
      <pointLight position={[-4, 2, 3]} intensity={1.2} color={sparkColor} />

      {/* 本地程序化环境光（Lightformer 烘焙，不联网）让 PBR 材质有反射 */}
      <Environment resolution={256} frames={1}>
        <Lightformer intensity={2} position={[0, 2, 4]} scale={[6, 6, 1]} />
        <Lightformer
          intensity={1.2}
          position={[-4, 0, 2]}
          scale={[3, 6, 1]}
          color="#88aaff"
        />
        <Lightformer
          intensity={1.2}
          position={[4, 0, 2]}
          scale={[3, 6, 1]}
          color="#ff88cc"
        />
      </Environment>

      <Float speed={1.6} rotationIntensity={0.3} floatIntensity={0.8}>
        <Suspense fallback={null}>
          <FriezaModel mood={mood} eyeOffset={eyeOffset} />
        </Suspense>
      </Float>

      {/* 能量粒子特效（颜色随 mood） */}
      <Sparkles
        count={80}
        scale={6}
        size={2.5}
        speed={0.5}
        opacity={0.5}
        color={sparkColor}
      />

      <ContactShadows
        position={[0, -2.2, 0]}
        opacity={0.5}
        scale={8}
        blur={2.5}
        far={4}
      />
    </Canvas>
  );
};

// 预加载，避免白屏
useGLTF.preload(MODEL_URL);
