import { useEffect, useRef, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  AnimationManager,
  BodyChannelAuthority,
  BagCharacterExpression,
  BehaviorVMAdapter,
  EmbodimentRuntime,
  kernelEventBus,
  driveEngine,
  type AvatarLifeState,
} from "@avatar-os/runtime";
import { NEUTRAL_EMOTIONAL_STATE } from "@avatar-os/primitives";
import { gazeBus } from "./gazeBus";
import { moodEmissive } from "./moodColor";
import { findBone, findBoneByName } from "./rigCommon";
import type { SkinProps } from "./types";
import type { RigConfig } from "./RiggedGLBSkin";
import { BAG_CONFIG } from "./RiggedGLBSkin";
import { useAvatarLoader } from "./avatarLoader";
import { breathingOffset } from "./procedural-idle";

interface Engine {
  animation: AnimationManager;
  expression: BagCharacterExpression;
  bridge: BehaviorVMAdapter;
}

/**
 * 标准 Avatar 皮肤 —— 消费 AvatarLoader 归一化后的模型 + 彻底解耦的 Adapter 引擎。
 *
 * 管线：useAvatarLoader(洗澡/称重/体检) → AnimationManager + ExpressionController + BehaviorVMAdapter
 * 内核只认接口，不认 GLB 资产；换模型 = 换 config（或换 ExpressionController 实现），此处不动。
 */
function StandardModel({ mood, config }: SkinProps & { config: RigConfig }) {
  const { scene, actions, mixer, capabilities, transform } = useAvatarLoader(config.url, config.fitHeight);
  const headRef = useRef<THREE.Object3D | null>(null);
  const spineRef = useRef<THREE.Object3D | null>(null);
  // 骨骼绑定姿态下的原始 local position——呼吸偏移在这个基准上叠加，
  // 不能直接覆盖 spine.position（会清空绑定姿态原有的非零偏移）。
  const spineBasePosRef = useRef<THREE.Vector3 | null>(null);
  const engineRef = useRef<Engine | null>(null);
  // Phase 2.2：当前身体的通道占用事实板。AnimationManager 事件 → 本装配层 → Authority。
  // Phase 2.3：useFrame 中 gaze/headTilt/breathing/expression 四处写入前读取它做门控（见下方 useFrame）。
  const authorityRef = useRef<BodyChannelAuthority | null>(null);

  useEffect(() => {
    const head = findBone(scene, config.headBone);
    // spineBone 是字符串（如 "Spine01"，真实骨骼名，无虚构的 Spine）；找不到则无姿态降级
    const spine = config.spineBone ? findBoneByName(scene, config.spineBone) : null;
    headRef.current = head;
    spineRef.current = spine;
    spineBasePosRef.current = spine ? spine.position.clone() : null;

    const animation = new AnimationManager(mixer, actions, { idleClip: config.idleClip });
    const expression = new BagCharacterExpression(spine);
    const embodiment = new EmbodimentRuntime();
    const bridge = new BehaviorVMAdapter(animation, expression, embodiment, {
      // RigConfig 结构性满足 PrimitiveBindings（intentClip/statusClip/idleClip/spineBone）
      bindings: config,
      capability: capabilities,
      getLife: (): AvatarLifeState => ({
        life: driveEngine.getState(),
        emotion: NEUTRAL_EMOTIONAL_STATE,
        presence: { userNearby: true, isFocused: false },
      }),
      // 气泡复用现有 AVATAR_THOUGHT 事件，不发明新通道
      onSpeech: (text) =>
        kernelEventBus.emit("AVATAR_THOUGHT", { emoji: "💬", text, kind: "thought", source: "INTENT" }),
    });

    // Phase 2.2：AnimationManager 只发 clip 生命周期事件；本装配层监听后把事实转译给 Authority。
    // 依赖方向严格遵守：AnimationManager → (event) → 这里 → BodyChannelAuthority，
    // AnimationManager 全程不认识 Authority / 不认识任何身体通道规则。
    const authority = new BodyChannelAuthority();
    authorityRef.current = authority;
    const ownershipMap = animation.discoverOwnership();
    let activeClip: string | null = null;
    const unsubscribe = animation.subscribe((e) => {
      if (e.type === "started") {
        // 直接切换（非 finished 中介）时，先清上一个 clip 的占用，避免旧通道泄漏
        if (activeClip && ownershipMap[activeClip]) authority.clearOwner(ownershipMap[activeClip]);
        activeClip = e.clip;
        authority.setOwner(ownershipMap[e.clip] ?? [], "animation");
      } else {
        authority.clearOwner(ownershipMap[e.clip] ?? []);
        if (activeClip === e.clip) activeClip = null;
      }
    });

    engineRef.current = { animation, expression, bridge };
    bridge.connect();
    animation.play(config.idleClip); // 默认播 idle → 触发 started 事件，Authority 接收占用

    // 体检报告：换任意 Mod 模型后，打开 Console 看这里即可知道系统识别到了什么能力
    console.log("[AvatarLoader 🧬] Model Capabilities:", capabilities);

    return () => {
      unsubscribe();
      bridge.disconnect();
      // HMR/重挂载防污染：把 spine.position 还原到本轮记录的绑定姿态基准，
      // 避免下次 useEffect 重跑时 clone() 到"已叠加过呼吸偏移"的脏值，
      // 导致开发态每次热更呼吸幅度悄悄往上漂。生产态只 mount 一次，此行为空操作。
      const spine = spineRef.current;
      const basePos = spineBasePosRef.current;
      if (spine && basePos) spine.position.copy(basePos);
      authorityRef.current = null;
      engineRef.current = null;
    };
  }, [scene, actions, mixer, capabilities, config]);

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
  // Phase 2.3：Expression / Breathing / Gaze / HeadTilt 四处写入前查 Authority 门控，
  // 动画占用的通道 → 程序层本帧让出（YIELD），让动画完整控制身体；动画未占 → 照常运行（生命感保留）。
  // 依赖方向：各层只查、不决定；Authority 只存事实。AnimationManager 写入语义未变。
  useFrame((state, delta) => {
    const engine = engineRef.current;
    if (!engine) return;
    const authority = authorityRef.current;

    engine.animation.tick(delta);

    // Expression：声明通道 Spine.rotation；动画占用该通道时让出，保留动画躯干姿态
    const spine = spineRef.current;
    if (
      spine &&
      (!authority || authority.canWrite({ bone: spine.name, property: "rotation" }, "expression") === "ALLOW")
    ) {
      engine.expression.update(delta);
    }

    // 待机呼吸：声明通道 Spine.position；动画占用该通道时整段让出 ——
    // ⚠️ 绝不回写 basePos，否则会把动画的脊柱位移覆盖掉（这是之前 Phase 1.5 发现的隐藏 bug）。
    const basePos = spineBasePosRef.current;
    if (
      spine &&
      basePos &&
      (!authority || authority.canWrite({ bone: spine.name, property: "position" }, "breathing") === "ALLOW")
    ) {
      spine.position.y = basePos.y + breathingOffset(state.clock.elapsedTime);
    }

    const head = headRef.current;
    if (head) {
      // 视线跟随：声明通道 Head.rotation（含 X/Y 轴）；动画占 Head.rotation 时让出转头，保留动画头部动作
      const gazeAllowed =
        !authority || authority.canWrite({ bone: head.name, property: "rotation" }, "gaze") === "ALLOW";
      if (gazeAllowed) {
        const gx = THREE.MathUtils.clamp(gazeBus.x / 8, -1, 1);
        const gy = THREE.MathUtils.clamp(gazeBus.y / 8, -1, 1);
        head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, gx * 0.6, 0.12);
        head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, -gy * 0.42, 0.12);
      }
      // 头部 idle 微摆（Z 轴 roll）：声明通道同为 Head.rotation；动画占 Head.rotation 时一并让出
      // （按 BOSS 决策：Gaze 与 HeadTilt 共享 Head.rotation 决策，是主动选择，不是遗漏）
      const tiltAllowed =
        !authority || authority.canWrite({ bone: head.name, property: "rotation" }, "headTilt") === "ALLOW";
      if (tiltAllowed) {
        const tiltRad = THREE.MathUtils.degToRad(gazeBus.headTilt ?? 0);
        head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, tiltRad, 0.12);
      }
    }
  });

  // 归一化：尺寸/定位交给包裹 group 的 transform，绝不 mutate 共享缓存的 scene
  return (
    <group scale={transform.scale} position={transform.position}>
      <primitive object={scene} />
    </group>
  );
}

export function StandardAvatarSkin({ mood, config = BAG_CONFIG }: SkinProps & { config?: RigConfig }) {
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
        <StandardModel mood={mood} config={config} />
      </Suspense>
    </Canvas>
  );
}

// 注（v0.3.4-A）：原 StandardMVPSkin 薄壳已移除——它在下方写死 `config={BAG_CONFIG}`，
// 使"当前身体"由 UI 组件常量决定（隐式所有权落点）。
// 现由 Avatar.tsx 经 avatarService 解析 profile 后，把 config 作为 prop 下传，
// StandardAvatarSkin 只认 config prop（默认 BAG_CONFIG 仅作类型兜底），不持有 active 状态。

useGLTF.preload(BAG_CONFIG.url);
