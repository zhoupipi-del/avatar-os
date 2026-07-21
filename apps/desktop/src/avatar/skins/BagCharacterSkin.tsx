import { useEffect, useRef, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { AnimationManager, BagCharacterExpression, BehaviorVMAdapter } from "@avatar-os/runtime";
import { gazeBus } from "./gazeBus";
import { moodEmissive } from "./moodColor";
import { frameModel, findBone, findBoneByName } from "./rigCommon";
import type { SkinProps } from "./types";
import type { RigConfig } from "./RiggedGLBSkin";
import { BAG_CONFIG } from "./RiggedGLBSkin";

interface Engine {
  animation: AnimationManager;
  expression: BagCharacterExpression;
  bridge: BehaviorVMAdapter;
}

/**
 * Bag Character 皮肤 —— 3D 解耦架构的「物理挂载点」。
 *
 * 它只负责把 Adapter 引擎(AnimationManager / ExpressionController / BehaviorVMAdapter)
 * 组装到 R3F 视图层，并把内核事件接到模型上。脏活全在 @avatar-os/runtime/avatar-adapter，
 * 这里不写任何动画/骨骼逻辑。换身体 = 换 config（或换 ExpressionController 实现），此处不动。
 */
function BagModel({ mood, config }: SkinProps & { config: RigConfig }) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(config.url);
  const headRef = useRef<THREE.Object3D | null>(null);
  const engineRef = useRef<Engine | null>(null);

  // 自动取景 + 定位头骨/脊椎骨 + 组装并挂载引擎
  useEffect(() => {
    frameModel(scene, config.fitHeight);

    const head = findBone(scene, config.headBone);
    const spine = config.spineBone ? findBoneByName(scene, config.spineBone) : null;
    headRef.current = head;

    const animation = new AnimationManager(scene, animations, { idleClip: config.idleClip });
    const expression = new BagCharacterExpression(spine);
    const bridge = new BehaviorVMAdapter(animation, expression, {
      idleClip: config.idleClip,
      intentClip: config.intentClip,
      statusClip: config.statusClip,
    });

    engineRef.current = { animation, expression, bridge };
    bridge.connect();
    animation.play(config.idleClip); // 默认播 idle

    return () => {
      bridge.disconnect();
      engineRef.current = null;
    };
  }, [scene, animations, config]);

  // mood → 材质自发光染色（无脸模型的"灯光表情"，与 2D moodColor 语义一致）
  useEffect(() => {
    const color = new THREE.Color(moodEmissive(mood));
    scene.traverse((o: THREE.Object3D) => {
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

  // 每帧：推进动画混合器 + 推进姿态 lerp + 视线骨骼跟随
  useFrame((_, delta) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.animation.tick(delta);
    engine.expression.update(delta);

    const head = headRef.current;
    if (head) {
      const gx = THREE.MathUtils.clamp(gazeBus.x / 8, -1, 1);
      const gy = THREE.MathUtils.clamp(gazeBus.y / 8, -1, 1);
      head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, gx * 0.6, 0.12);
      head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, -gy * 0.42, 0.12);
    }
  });

  return <primitive ref={group} object={scene} />;
}

export function BagCharacterSkin({ mood, config }: SkinProps & { config: RigConfig }) {
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
        <BagModel mood={mood} config={config} />
      </Suspense>
    </Canvas>
  );
}

/** MVP 身体：直接以 bag character 配置挂载 */
export function BagCharacterMVPSkin({ mood }: SkinProps) {
  return <BagCharacterSkin mood={mood} config={BAG_CONFIG} />;
}

useGLTF.preload(BAG_CONFIG.url);
