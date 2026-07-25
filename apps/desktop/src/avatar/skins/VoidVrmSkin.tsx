/**
 * VoidVrmSkin — VRM 皮肤组件（AvatarSample_Z.vrm）
 *
 * 管线：
 *   loadVrm(.vrm) → [可选] loadVrmActions(.vrma) → AnimationManager
 *   → BodyChannelAuthority 仲裁
 *   → VrmExpressionController (BlendShape + 骨骼 lean/tilt)
 *   → VrmBlinkController (程序化眨眼)
 *   → gazeBus (视线跟随，复用现有 LookAt 骨骼或 VRM LookAt)
 *   → vrm.update(delta) (SpringBone / 约束)
 *   → render
 *
 * 与 StandardAvatarSkin 的关系：
 *   - 同样实现 Authority 门控（canWrite 两参数 API）
 *   - 同样消费 gazeBus 做头部跟随
 *   - 不同：数据源是 VRM（非 GLB），表情走 BlendShape（非骨骼旋转）
 *   - 不同：有独立的 blink 控制器（VRM 有 blink 表情）
 *
 * V1 目标：模型显示 + 材质 + 眨眼 + 表情 + LookAt + SpringBone。
 * 无 VRMA 时程序化降级（呼吸/headTilt/gaze）。
 */

import { useEffect, useRef, Suspense, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  AnimationManager,
  BodyChannelAuthority,
  BehaviorVMAdapter,
  EmbodimentRuntime,
  kernelEventBus,
  driveEngine,
  type AvatarLifeState,
  type ChannelProperty,
} from "@avatar-os/runtime";
import { NEUTRAL_EMOTIONAL_STATE } from "@avatar-os/primitives";
import { gazeBus } from "./gazeBus";
import { loadVrm, disposeVrm } from "../vrm/load-vrm";
import { loadVrmActions } from "../vrm/load-vrma";
import { VrmBlinkController } from "../vrm/VrmBlinkController";
import { VrmExpressionController } from "../vrm/VrmExpressionController";
import { calculateVisibleMeshFrame, type VrmFrameTransform } from "../vrm/vrm-framing";
import { VOID_AVATAR_PROFILE } from "../void-avatar-profile";
import type { SkinProps } from "./types";

interface VrmEngine {
  vrm: import("@pixiv/three-vrm").VRM;
  animation: AnimationManager | null;
  expression: VrmExpressionController;
  bridge: BehaviorVMAdapter;
  blink: VrmBlinkController;
  authority: BodyChannelAuthority;
}

/**
 * 内部模型组件 —— 挂载 VRM 到 R3F 场景，驱动每帧管线
 */
function VoidModel({ mood }: { mood: SkinProps["mood"] }) {
  const [vrm, setVrm] = useState<import("@pixiv/three-vrm").VRM | null>(null);
  const engineRef = useRef<VrmEngine | null>(null);
  const containerRef = useRef<THREE.Group>(null);
  // gaze 叠加量缓存：动画写基础头部姿态后，由本组件叠加幅度有限的视线偏移；
  // 每帧先撤销上一帧叠加量避免累计漂移，再叠加本帧平滑后偏移。
  const gazeOverlayRef = useRef({ x: 0, y: 0 });
  const [frame, setFrame] = useState<VrmFrameTransform | null>(null);

  // ─── 加载 VRM ───
  useEffect(() => {
    let cancelled = false;
    let disposedVrm: import("@pixiv/three-vrm").VRM | undefined;

    loadVrm(VOID_AVATAR_PROFILE.modelUrl)
      .then((loaded) => {
        if (cancelled) {
          disposeVrm(loaded);
          return;
        }
        setVrm(loaded);
      })
      .catch((err) => {
        console.error("[VOID] Failed to load VRM:", err);
      });

    return () => {
      cancelled = true;
      if (disposedVrm) disposeVrm(disposedVrm);
    };
  }, []);

  // ─── VRM 就绪后装配引擎 ───
  useEffect(() => {
    if (!vrm) return;

    let cancelled = false;

    const setup = async () => {
      // 0. 取景：只按可见网格算包围盒，缩放到 fitHeight 并居中（忽略 SpringBone/collider 空节点）
      setFrame(calculateVisibleMeshFrame(vrm.scene, VOID_AVATAR_PROFILE.fitHeight));

      // 1. 表情控制器（实现 ExpressionController 接口）
      const expression = new VrmExpressionController(
        vrm,
        // canWrite 闭包：延迟绑定到 authority（下方创建后自然生效）
        (ch, owner) =>
          engineRef.current?.authority.canWrite(ch, owner) ?? "ALLOW",
      );

      // 2. 眨眼控制器
      const blink = new VrmBlinkController();

      // 3. Authority（动画通道仲裁）
      const authority = new BodyChannelAuthority();

      // 4. 动画系统（可选 VRMA，无则纯程序化）
      let animation: AnimationManager | null = null;
      const actionUrls = VOID_AVATAR_PROFILE.actions;

      if (Object.keys(actionUrls).length > 0) {
        try {
          const loaded = await loadVrmActions(
            vrm,
            actionUrls,
            VOID_AVATAR_PROFILE.rootMotionMode,
          );
          animation = new AnimationManager(loaded.mixer, loaded.actions, {
            idleClip: "IDLE",
          });

          // 注册 clip 占用映射到 Authority
          const ownershipMap = animation.discoverOwnership();
          let activeClip: string | null = null;
          animation.subscribe((e) => {
            if (e.type === "started") {
              if (activeClip && ownershipMap[activeClip]) {
                authority.clearOwner(ownershipMap[activeClip]);
              }
              activeClip = e.clip;
              authority.setOwner(
                ownershipMap[e.clip] ?? [],
                "animation",
              );
            } else {
              authority.clearOwner(ownershipMap[e.clip] ?? []);
              if (activeClip === e.clip) activeClip = null;
            }
          });
        } catch (err) {
          console.warn("[VOID] VRMA loading failed, running procedural-only:", err);
        }
      }

      // 5. 行为适配器（意图 → 动画/表情桥接）
      const embodiment = new EmbodimentRuntime();
      // TSX 中 ??/箭头函数后直接跟 {} 会被解析器当 JSX，必须提前提取到变量
      const noOpAnimation: AnimationManager = {
        tick: (_delta: number) => {},
        play: (_clip?: string) => {},
        subscribe: (_fn: (e: unknown) => void) => (() => {}),
        discoverOwnership: () => ({}),
      } as unknown as AnimationManager;
      const bridge = new BehaviorVMAdapter(
        animation ?? noOpAnimation,
        expression,
        embodiment,
        {
          // BehaviorVMAdapter 需要 PrimitiveBindings；VRM profile 字段不同，手动构造
          bindings: {
            idleClip: "IDLE",
            intentClip: Object.fromEntries(
              Object.entries(VOID_AVATAR_PROFILE.actions).filter(([k]) =>
                k !== "IDLE",
              ),
            ),
            statusClip: {},
            spineBone: "spine", // VRM humanoid 有标准 spine 骨骼
          },
          capability: {
            hasSkeleton: true,
            hasBlendShapes: true,
            availableAnimations: animation ? Object.keys(VOID_AVATAR_PROFILE.actions) : [],
            skeletonBoneNames: [],
            supportedBones: [],
            availableClips: [],
            features: ["facial_expression", "prebaked_animation"],
            hasMaterialEmotion: false,
            availableBlendShapes: ["happy", "sad", "relaxed", "surprised", "blink"],
          },
          getLife: (): AvatarLifeState => ({
            life: driveEngine.getState(),
            emotion: NEUTRAL_EMOTIONAL_STATE,
            presence: { userNearby: true, isFocused: false },
          }),
          onSpeech: (text) =>
            kernelEventBus.emit("AVATAR_THOUGHT", {
              emoji: "💬",
              text,
              kind: "thought",
              source: "INTENT",
            }),
        },
      );

      if (cancelled) {
        bridge.disconnect();
        if (animation) {
          // cleanup mixer
        }
        return;
      }

      const engine: VrmEngine = {
        vrm,
        animation,
        expression,
        bridge,
        blink,
        authority,
      };
      engineRef.current = engine;

      bridge.connect();

      // 播放默认 idle（如果有 VRMA）
      if (animation) {
        animation.play("IDLE");
      }

      console.log("[VOID] Engine assembled, model:", VOID_AVATAR_PROFILE.displayName);
    };

    setup();

    return () => {
      cancelled = true;
      const eng = engineRef.current;
      if (eng) {
        eng.bridge.disconnect();
        disposeVrm(eng.vrm);
      }
      engineRef.current = null;
    };
  }, [vrm]);

  // ─── 每帧管线 ───
  useFrame((state, delta) => {
    const eng = engineRef.current;
    if (!eng || !eng.vrm) return;

    // 1. AnimationManager.tick（推进动画混合器）
    if (eng.animation) {
      eng.animation.tick(delta);
    }

    // 2. VrmExpressionController.update（BlendShape + lean/tilt，内部查 Authority）
    eng.expression.update(delta);

    // 3. 视线跟随（head 骨骼）
    //    注意：VOID 的 idle VRMA 片段会占用 Head.rotation 通道，导致
    //    BodyChannelAuthority 对 gaze 返回 YIELD，canWrite 独占写入不可用。
    //    因此改为「动画之后 additive overlay」：mixer 已把 VRMA 基础头部姿态写到
    //    head.rotation，这里先撤销上一帧 gaze 叠加量（防累计漂移），再叠加本帧
    //    平滑后的小幅视线偏移。不抢动画、不放开 authority、不影响 BAG/Warrior。
    const head = eng.vrm.humanoid.getNormalizedBoneNode("head");
    if (head) {
      const previous = gazeOverlayRef.current;
      // 先撤销上一帧 gaze overlay，恢复 mixer 写入的 VRMA 基础头部姿态
      head.rotation.x -= previous.x;
      head.rotation.y -= previous.y;

      const gx = THREE.MathUtils.clamp(gazeBus.x / 8, -1, 1);
      const gy = THREE.MathUtils.clamp(gazeBus.y / 8, -1, 1);

      const targetX = THREE.MathUtils.clamp(-gy * 0.22, -0.22, 0.22);
      const targetY = THREE.MathUtils.clamp(gx * 0.34, -0.34, 0.34);

      const blend = 1 - Math.exp(-delta * 8);
      previous.x = THREE.MathUtils.lerp(previous.x, targetX, blend);
      previous.y = THREE.MathUtils.lerp(previous.y, targetY, blend);

      // 在 VRMA 当前头部姿态上叠加平滑后的视线偏移
      head.rotation.x += previous.x;
      head.rotation.y += previous.y;

      // headTilt（Z 轴 roll，与 gaze 共享 Head.rotation 决策，超出本次 V1-lookat 小修范围保持原样）
      const tiltAllowed =
        eng.authority.canWrite(
          { bone: head.name, property: "rotation" },
          "headTilt",
        ) === "ALLOW";
      if (tiltAllowed) {
        const tiltRad = THREE.MathUtils.degToRad(gazeBus.headTilt ?? 0);
        head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, tiltRad, 0.12);
      }
    }

    // 4. VrmBlinkController.update（程序化眨眼）
    eng.blink.update(eng.vrm, delta);

    // 5. vrm.update(delta) — 必须调用！驱动 SpringBone、LookAt、约束
    eng.vrm.update(delta);
  });

  if (!vrm || !frame) return null;

  return (
    <group
      ref={containerRef}
      rotation-y={VOID_AVATAR_PROFILE.rotationY}
      scale={frame.scale}
      position={[
        frame.position[0],
        frame.position[1] - 0.25,
        frame.position[2],
      ]}
    >
      <primitive object={vrm.scene} />
    </group>
  );
}

/**
 * VOID VRM 皮肤入口 —— 与 StandardAvatarSkin 同级，供 Avatar.tsx 按格式选择渲染
 */
export function VoidVrmSkin({ mood }: SkinProps) {
  return (
    <Canvas
      camera={{ position: [0, VOID_AVATAR_PROFILE.fitHeight * 0.3, 5], fov: 35 }}
      gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 5, 4]} intensity={1.3} />
      <directionalLight position={[-3, 2, -2]} intensity={0.45} />
      <Suspense fallback={null}>
        <VoidModel mood={mood} />
      </Suspense>
    </Canvas>
  );
}
