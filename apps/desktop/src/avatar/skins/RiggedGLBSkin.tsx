import { useEffect, useRef, useState, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { kernelEventBus } from "@avatar-os/runtime";
import { moodEmissive } from "./moodColor";
import { gazeBus } from "./gazeBus";
import type { SkinProps } from "./types";

/** rigged 模型配置：换模型只改这里，渲染管线不变。 */
export interface RigConfig {
  url: string;
  /** 头骨名正则（用于视线追踪接管扭头） */
  headBone: RegExp;
  /** 默认循环片段（Idle/待机） */
  idleClip: string;
  /** 物理意图 → 片段名（近似映射，需按真实动作标定） */
  intentClip: Record<string, string>;
  /** 系统状态 → 片段名 */
  statusClip: Record<string, string>;
  /** 自动取景目标高度（世界单位），相机固定 [0,0.3,5] fov35 */
  fitHeight: number;
}

// three 官方示例机器人：片段名语义清晰（Idle/Wave/Jump/ThumbsUp/No/Sitting）
const ROBOT_CONFIG: RigConfig = {
  url: "/models/RobotExpressive.glb",
  headBone: /head/i,
  idleClip: "Idle",
  intentClip: { GREET: "Wave", BOUNCE_HAPPY: "Jump", STRETCH: "Wave", DOZE: "Sitting" },
  statusClip: { success: "ThumbsUp", error: "No" },
  fitHeight: 2.4,
};

// bag character（Tripo/AI 生成）：真·骨骼(41 关节) + 3 条 NLA 整段动作，无面部形变。
// 3 个 clip 实为 NlaTrack/NlaTrack.001/NlaTrack.002（Blender 导出残留名，无语义），
// 下面是按"时长"做的近似映射，BOSS 需实际看哪条是挥手再校准：
//   NlaTrack(4.00s)       → 待机
//   NlaTrack.001(2.58s)   → 打招呼/出错（最短，像定点动作）
//   NlaTrack.002(12.79s)  → 成功/欢呼（最长，大幅动作）
const BAG_CONFIG: RigConfig = {
  url: "/models/bag-character.glb",
  headBone: /^head$/i,
  idleClip: "NlaTrack",
  intentClip: { GREET: "NlaTrack.001", BOUNCE_HAPPY: "NlaTrack.002", STRETCH: "NlaTrack.001", DOZE: "NlaTrack" },
  statusClip: { success: "NlaTrack.002", error: "NlaTrack.001" },
  fitHeight: 2.6,
};

function Model({ mood, config }: SkinProps & { config: RigConfig }) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(config.url);
  const { actions, names } = useAnimations(animations, group);
  const headRef = useRef<THREE.Object3D | null>(null);
  const [, setActive] = useState<string>(config.idleClip);

  // 自动取景：包围盒居中 + 按目标高度缩放，相机固定即可稳定框住
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const scale = config.fitHeight / (size.y || 1);
    scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    scene.scale.setScalar(scale);
  }, [scene, config.fitHeight]);

  // 定位头部骨骼（按配置正则匹配）
  useEffect(() => {
    let found: THREE.Object3D | null = null;
    scene.traverse((o) => {
      if (!found && config.headBone.test(o.name)) found = o;
    });
    headRef.current = found;
  }, [scene, config.headBone]);

  // 默认播 idle
  useEffect(() => {
    const idle = actions[config.idleClip] ?? actions[names[0]];
    idle?.reset().fadeIn(0.2).play();
    return () => {
      idle?.fadeOut(0.2);
    };
  }, [actions, names, config.idleClip]);

  // 意图/系统状态 → 片段（播完回 idle）
  useEffect(() => {
    const play = (clip: string) => {
      const a = actions[clip];
      if (!a) return;
      Object.values(actions).forEach((x) => x?.stop());
      a.reset().setLoop(THREE.LoopOnce, 1).play();
      const mixer = a.getMixer();
      const back = () => {
        const idle = actions[config.idleClip] ?? actions[names[0]];
        idle?.reset().fadeIn(0.3).play();
        mixer.removeEventListener("finished", back);
      };
      mixer.addEventListener("finished", back);
      setActive(clip);
    };
    const u1 = kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (intent: any) => {
      const c = config.intentClip[intent?.type];
      if (c) play(c);
    });
    const u2 = kernelEventBus.on("SYSTEM_STATUS_CHANGED", (p: any) => {
      const c = config.statusClip[p?.status];
      if (c) play(c);
    });
    return () => {
      u1();
      u2();
    };
  }, [actions, names, config]);

  // mood → 材质自发光染色（机器人/无脸角色用色晕替代表情）
  useEffect(() => {
    const color = new THREE.Color(moodEmissive(mood));
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as
        | THREE.MeshStandardMaterial
        | THREE.MeshStandardMaterial[]
        | undefined;
      if (!mat) return;
      const list = Array.isArray(mat) ? mat : [mat];
      list.forEach((m) => {
        if (m.emissive) {
          m.emissive.copy(color);
          m.emissiveIntensity = 0.3;
        }
      });
    });
  }, [mood, scene]);

  // 视线骨骼跟随（平滑 lerp），gazeBus.x/y ∈ [-8,8]。
  // drei useAnimations 用 priority -1 更新 mixer，本 useFrame(priority 0) 后跑，
  // 故头部旋转以视线为准（片段也动头时会短暂被覆盖，idle 回正）。
  useFrame(() => {
    const head = headRef.current;
    if (!head) return;
    const gx = THREE.MathUtils.clamp(gazeBus.x / 8, -1, 1);
    const gy = THREE.MathUtils.clamp(gazeBus.y / 8, -1, 1);
    head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, gx * 0.6, 0.12);
    head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, -gy * 0.42, 0.12);
  });

  return <primitive ref={group} object={scene} />;
}

export function RiggedGLBSkin({ mood, config = BAG_CONFIG }: SkinProps & { config?: RigConfig }) {
  return (
    <Canvas
      camera={{ position: [0, 0.3, 5], fov: 35 }}
      gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 5, 4]} intensity={1.3} />
      <directionalLight position={[-3, 2, -2]} intensity={0.45} />
      <Suspense fallback={null}>
        <Model mood={mood} config={config} />
      </Suspense>
    </Canvas>
  );
}

export { BAG_CONFIG, ROBOT_CONFIG };
useGLTF.preload(BAG_CONFIG.url);
useGLTF.preload(ROBOT_CONFIG.url);
