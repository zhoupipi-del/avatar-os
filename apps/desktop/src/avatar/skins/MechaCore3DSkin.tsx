import React, { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Float,
  Sparkles,
  Environment,
  Lightformer,
  ContactShadows,
} from "@react-three/drei";
import * as THREE from "three";
import { Mood } from "@avatar-os/primitives";
import type { AvatarSkinProps } from "./types";
import { moodColor } from "./moodColor";

// VisualFrame.eyeOffset 上限（visual-transform 的 MAX_EYE_SHIFT）
const GAZE_RANGE = 8;

// --- 内部 3D 场景：次世代机甲悬浮核心 ---
const MechaEye: React.FC<{
  mood: Mood;
  eyeOffset: { x: number; y: number };
}> = ({ mood, eyeOffset }) => {
  const groupRef = useRef<THREE.Group>(null);
  const coreMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (!groupRef.current || !coreMatRef.current || !ringRef.current) return;

    // 1. 物理 IK 视线追踪：机甲眼死死盯住鼠标方向（gazeOffset 范围 [-1,1]）
    const gx = Math.max(-1, Math.min(1, (eyeOffset.x || 0) / GAZE_RANGE));
    const gy = Math.max(-1, Math.min(1, (eyeOffset.y || 0) / GAZE_RANGE));
    const targetX = gy * (Math.PI / 3);
    const targetY = gx * (Math.PI / 3);
    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x,
      targetX,
      0.1,
    );
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      targetY,
      0.1,
    );

    // 2. 外部装甲环自转
    ringRef.current.rotation.z += delta * 0.5;
    ringRef.current.rotation.x += delta * 0.2;

    // 3. 情绪颜色平滑过渡（发光材质）
    const target = moodColor(mood);
    coreMatRef.current.color.lerp(target, 0.05);
    coreMatRef.current.emissive.lerp(target, 0.05);
  });

  return (
    <group ref={groupRef}>
      {/* 核心能量球 */}
      <mesh scale={1.2}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial
          ref={coreMatRef}
          wireframe={mood === Mood.SLEEPING}
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>

      {/* 机械装甲外环 */}
      <mesh ref={ringRef} scale={1.8}>
        <torusGeometry args={[1, 0.15, 16, 64]} />
        <meshStandardMaterial
          color="#1e272e"
          metalness={0.9}
          roughness={0.1}
          envMapIntensity={2}
        />
      </mesh>

      {/* 内置瞳孔结构 */}
      <mesh position={[0, 0, 1.1]}>
        <cylinderGeometry args={[0.3, 0.3, 0.1, 32]} />
        <meshStandardMaterial color="#000000" metalness={1} />
      </mesh>
    </group>
  );
};

// --- 对外暴露的 3D 皮肤容器（无需外部模型文件）---
export const MechaCore3DSkin: React.FC<AvatarSkinProps> = ({ mood, frame }) => {
  const eyeOffset = frame.eyeOffset;
  const sparkColor = moodColor(mood).getStyle();
  return (
    // 透明背景，铺满父级 drag-region-wrap
    <Canvas
      className="skin-3d"
      camera={{ position: [0, 0, 5], fov: 50 }}
      gl={{ alpha: true, antialias: true }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.5} />
      {/* 本地程序化环境光（Lightformer 烘焙，不联网）让金属有质感 */}
      <Environment resolution={256} frames={1}>
        <Lightformer intensity={2} position={[0, 0, 5]} scale={10} />
        <Lightformer
          intensity={1}
          position={[-5, 0, 1]}
          scale={5}
          color="#88aaff"
        />
      </Environment>

      {/* 悬浮动效：像呼吸一样上下浮动 */}
      <Float speed={2} rotationIntensity={0.5} floatIntensity={1}>
        <MechaEye mood={mood} eyeOffset={eyeOffset} />
      </Float>

      {/* 能量粒子特效 */}
      <Sparkles
        count={100}
        scale={5}
        size={2}
        speed={0.4}
        opacity={0.5}
        color={sparkColor}
      />

      {/* 底部逼真的接触阴影 */}
      <ContactShadows
        position={[0, -2, 0]}
        opacity={0.7}
        scale={10}
        blur={2}
        far={4}
      />
    </Canvas>
  );
};
