/**
 * VoidVrmSkin — VRM 皮肤组件（AvatarSample_Z.vrm）
 *
 * 管线（V2 Final Calibration）:
 *   loadVrm(.vrm) → [可选] loadVrmActions(.vrma) → AnimationManager
 *   → BodyChannelAuthority 仲裁
 *   → VrmGazeController (Head/Neck/Spine 80/15/5 additive overlay)
 *   → VrmExpressionController (BlendShape + 骨骼 lean/tilt, canWrite 闸门)
 *   → VrmBlinkController (程序化眨眼, 5-phase smoothstep)
 *   → VrmStabilityGuard (DEV-only NaN/∞ 检查)
 *   → gazeBus.headTilt (Z 轴 roll, canWrite 闸门)
 *   → vrm.update(delta) (SpringBone / 约束)
 *   → render
 */

import { useEffect, useRef, Suspense, useState, type MutableRefObject } from "react";
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
import { VrmGazeController } from "../vrm/VrmGazeController";
import { VrmStabilityGuard } from "../vrm/VrmStabilityGuard";
import { VOID_CALIBRATION, validateVoidCalibration } from "../void-calibration";
import { getVoidMotionSemantic, validateVoidMotionSemantics } from "../void-motion-semantics";
import {
  validateVoidV2RuntimeGate,
  assertVoidV2RuntimeGate,
  formatVoidV2GateResult,
} from "../void-v2-stability-gate";
import { calculateVisibleMeshFrame, type VrmFrameTransform } from "../vrm/vrm-framing";
import { VOID_AVATAR_PROFILE } from "../void-avatar-profile";
import type { SkinProps } from "./types";
import {
  AgentInputOverlay,
  AgentRuntime,
  BrowserTtsController,
  LipSyncNoopHarness,
  LipSyncTextRhythmDriver,
  VoiceControlOverlay,
  createDefaultDemoBrain,
  probeLipShapes,
  type AgentBodyBridge,
  type AgentEmotion,
  type AgentIntent,
  type LipShapeProbeResult,
  type LipSyncNoopStatus,
  type LipSyncRhythmStatus,
} from "../agent";

declare global {
  interface Window {
    __avatarOSAgent?: {
      receiveText(text: string): Promise<unknown>;
      interrupt(): void;
      snapshot(): unknown;
    };
  }
}

interface VrmEngine {
  vrm: import("@pixiv/three-vrm").VRM;
  animation: AnimationManager | null;
  expression: VrmExpressionController;
  bridge: BehaviorVMAdapter;
  blink: VrmBlinkController;
  authority: BodyChannelAuthority;
  gaze: VrmGazeController;
  stability: VrmStabilityGuard;
  agentRuntime?: AgentRuntime;
  tts?: BrowserTtsController;
  lipShapeProbe?: LipShapeProbeResult;
  lipSyncNoop?: LipSyncNoopHarness;
  lipSyncRhythm?: LipSyncTextRhythmDriver;
}

function sanitizeFrameDelta(rawDelta: number): number {
  if (!Number.isFinite(rawDelta) || rawDelta <= 0) {
    return 0;
  }
  return Math.min(rawDelta, VOID_CALIBRATION.stability.maxDeltaSeconds);
}

function installVoidMotionTracker(
  animation: {
    play: (name: string) => void;
    playOnce: (name: string, onFinished?: () => void) => void;
  },
  activeMotionRef: MutableRefObject<string>,
): void {
  let sequence = 0;

  const rawPlay = animation.play.bind(animation);
  const rawPlayOnce = animation.playOnce.bind(animation);

  animation.play = (name: string) => {
    sequence += 1;

    const semantic = getVoidMotionSemantic(name);
    activeMotionRef.current = semantic.id;

    rawPlay(name);
  };

  animation.playOnce = (name: string, onFinished?: () => void) => {
    sequence += 1;
    const currentSequence = sequence;

    const semantic = getVoidMotionSemantic(name);
    activeMotionRef.current = semantic.id;

    rawPlayOnce(name, () => {
      if (sequence === currentSequence) {
        activeMotionRef.current = "IDLE";
      }

      onFinished?.();
    });
  };
}

/**
 * 从 profile actions 配置中提取已定义（非 undefined）的动作名。
 * 仅传真实可提炼的运行时数据给 Gate，不伪造 body ids。
 */
function getVoidActionNames(
  actions: Partial<Record<string, string>>,
): string[] {
  return Object.entries(actions)
    .filter(([, url]) => url !== undefined)
    .map(([name]) => name);
}

/**
 * v0.3.8-fast：把 AgentRuntime 的抽象 BodyBridge 接到 VOID 真实控制器。
 * 情绪 → VrmExpressionController 具名预设（happy/sad/thinking/drowsy/idle）；
 * 意图 → AnimationManager 的 VRMA clip（GREET/PEEK/THINKING/...）。
 * 不改 Scheduler 核心规则，只走现有 play/playOnce 通道。
 */
function createVoidAgentBodyBridge(
  eng: VrmEngine,
  setAgentSpeech: (text: string) => void,
  tts?: BrowserTtsController,
  lipSyncNoop?: LipSyncNoopHarness,
  lipSyncRhythm?: LipSyncTextRhythmDriver,
): AgentBodyBridge {
  return {
    speakText(text: string): void {
      setAgentSpeech(text);
      tts?.speak(text);
      lipSyncNoop?.notifySpeechText(text);
      lipSyncRhythm?.startText(text);
    },

    setEmotion(emotion: AgentEmotion): void {
      if (!eng.expression) {
        return;
      }

      switch (emotion.type) {
        case "happy":
          eng.expression.happy();
          return;
        case "sad":
          eng.expression.sad();
          return;
        case "thinking":
        case "curious":
          eng.expression.thinking();
          return;
        case "tired":
          eng.expression.drowsy();
          return;
        case "neutral":
        default:
          eng.expression.idle();
      }
    },

    playIntent(intent: AgentIntent): void {
      if (!eng.animation) {
        return;
      }

      switch (intent.type) {
        case "GREET":
          eng.animation.playOnce("GREET");
          return;
        case "GREET_ALT":
          eng.animation.playOnce("GREET_ALT");
          return;
        case "PEEK":
          eng.animation.playOnce("PEEK");
          return;
        case "THINKING":
          eng.animation.playOnce("THINKING");
          return;
        case "BOUNCE_HAPPY":
          eng.animation.playOnce("BOUNCE_HAPPY");
          return;
        case "HAPPY_IDLE":
          eng.animation.play("HAPPY_IDLE");
          return;
        case "SAD_BODY":
        case "COMFORT":
          eng.animation.playOnce("SAD_BODY");
          return;
        case "IDLE":
          eng.animation.play("IDLE");
          return;
        case "SPEAK":
        case "LISTEN":
        case "NONE":
        default:
          return;
      }
    },

    stop(): void {
      tts?.cancel();
      lipSyncNoop?.cancel();
      lipSyncRhythm?.cancel();
      eng.animation?.play("IDLE");
    },
  };
}

/**
 * 内部模型组件 —— 挂载 VRM 到 R3F 场景，驱动每帧管线
 */
function VoidModel({
  mood,
  onAgentSpeech,
  onTtsChange,
  onLipProbeChange,
  onLipSyncStatusChange,
  onRhythmStatusChange,
}: {
  mood: SkinProps["mood"];
  onAgentSpeech: (text: string) => void;
  onTtsChange?: (tts: BrowserTtsController | null) => void;
  onLipProbeChange?: (result: LipShapeProbeResult | null) => void;
  onLipSyncStatusChange?: (status: LipSyncNoopStatus | null) => void;
  onRhythmStatusChange?: (status: LipSyncRhythmStatus | null) => void;
}) {
  const [vrm, setVrm] = useState<import("@pixiv/three-vrm").VRM | null>(null);
  const engineRef = useRef<VrmEngine | null>(null);
  const containerRef = useRef<THREE.Group>(null);
  const stabilityElapsedRef = useRef(0);
  const activeVoidMotionRef = useRef<string>("IDLE");
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
      // DEV 门控：校验配置合法性（生产构建不跑）
      if (import.meta.env.DEV) {
        validateVoidCalibration();
        validateVoidMotionSemantics();
      }

      // 0. 取景：只按可见网格算包围盒，缩放到 fitHeight 并居中
      setFrame(calculateVisibleMeshFrame(vrm.scene, VOID_AVATAR_PROFILE.fitHeight));

      // 1. 表情控制器（实现 ExpressionController 接口，canWrite 闭包延迟绑定）
      const expression = new VrmExpressionController(
        vrm,
        (ch, owner) =>
          engineRef.current?.authority.canWrite(ch, owner) ?? "ALLOW",
      );

      // 2. 眨眼控制器（V2: 需要 vrm 实例引用）
      const blink = new VrmBlinkController(vrm);

      // 3. 视线控制器（V2: additive overlay, 80/15/5 分摊）
      const gaze = new VrmGazeController();

      // 4. 稳定性守卫（V2: delta 钳制 + DEV-only transform 检查）
      const stability = new VrmStabilityGuard();

      // 5. Authority（动画通道仲裁）
      const authority = new BodyChannelAuthority();

      // 6. 动画系统（可选 VRMA，无则纯程序化）
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

      // 6b. 安装 motion tracker：patch play/playOnce 以跟踪当前 active motion 语义
      if (animation) {
        installVoidMotionTracker(animation, activeVoidMotionRef);
      }

      // 6c. 禁用 VRM 默认 LookAt（避免与 additive gaze overlay 冲突）
      if (vrm.lookAt) {
        vrm.lookAt.target = null;
        vrm.lookAt.autoUpdate = false;
      }

      // 7. 行为适配器（意图 → 动画/表情桥接）
      const embodiment = new EmbodimentRuntime();
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
          bindings: {
            idleClip: "IDLE",
            intentClip: Object.fromEntries(
              Object.entries(VOID_AVATAR_PROFILE.actions).filter(([k]) =>
                k !== "IDLE",
              ),
            ),
            statusClip: {},
            spineBone: "spine",
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
        gaze.dispose(vrm);
        return;
      }

      const engine: VrmEngine = {
        vrm,
        animation,
        expression,
        bridge,
        blink,
        authority,
        gaze,
        stability,
      };
      engineRef.current = engine;

      // 7a. Day6 LipSync Probe：只读探测 a/i/u/e/o 口型 blendshape（不驱动嘴型）
      const lipProbe = probeLipShapes(vrm);
      engine.lipShapeProbe = lipProbe;
      onLipProbeChange?.(lipProbe);

      // 7b. Text-only Agent Runtime 接线（v0.3.8-fast）
      const tts = new BrowserTtsController({
        lang: "zh-CN",
        rate: 1,
        pitch: 1,
        volume: 1,
      });
      engine.tts = tts;
      onTtsChange?.(tts);

      // 7c. Day7 LipSync No-op Harness：安全壳，只收 speech 事件、暴露状态，不驱动嘴型
      const lipSyncNoop = new LipSyncNoopHarness();
      engine.lipSyncNoop = lipSyncNoop;
      if (engine.lipShapeProbe) {
        lipSyncNoop.setProbeResult({
          available: engine.lipShapeProbe.available,
          availableShapes: engine.lipShapeProbe.availableShapes,
          missingShapes: engine.lipShapeProbe.missing,
        });
      }

      // 7d. Day8 Text Rhythm State Driver：把 speech 文本转成可观察节奏状态，
      //     仍不写 VRM expression、不驱动嘴型、不接音频、不做 VisemeFrame。
      const lipSyncRhythm = new LipSyncTextRhythmDriver();
      engine.lipSyncRhythm = lipSyncRhythm;

      const agentBody = createVoidAgentBodyBridge(
        engine,
        onAgentSpeech,
        tts,
        lipSyncNoop,
        lipSyncRhythm,
      );
      const agentRuntime = new AgentRuntime(createDefaultDemoBrain(), agentBody);
      engine.agentRuntime = agentRuntime;
      window.__avatarOSAgent = {
        receiveText(text: string) {
          return agentRuntime.receiveText(text);
        },
        interrupt() {
          agentRuntime.interrupt();
        },
        snapshot() {
          return agentRuntime.snapshot();
        },
      };

      // 8. DEV-only V2 Stability Gate（只传真实可提炼项，不伪造 body ids）
      if (import.meta.env.DEV) {
        const gateInput = {
          vrm,
          actionNames: getVoidActionNames(actionUrls),
        } as const;
        const gateResult = validateVoidV2RuntimeGate(gateInput);
        if (!gateResult.passed) {
          console.error(formatVoidV2GateResult(gateResult));
          assertVoidV2RuntimeGate(gateInput);
        }
      }

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
        eng.tts?.dispose();
        eng.lipSyncNoop?.cancel();
        eng.lipSyncRhythm?.cancel();
        eng.bridge.disconnect();
        eng.gaze.dispose(eng.vrm);
        disposeVrm(eng.vrm);
      }
      engineRef.current = null;
      onTtsChange?.(null);
      onLipProbeChange?.(null);
      onLipSyncStatusChange?.(null);
      onRhythmStatusChange?.(null);
      delete window.__avatarOSAgent;
    };
  }, [vrm]);

  // ─── Day7/Day8 LipSync 状态轮询（500ms，只读 getStatus，不驱动嘴型） ───
  useEffect(() => {
    const interval = window.setInterval(() => {
      const eng = engineRef.current;
      if (eng?.lipSyncNoop) {
        eng.lipSyncNoop.update();
        onLipSyncStatusChange?.(eng.lipSyncNoop.getStatus());
      } else {
        onLipSyncStatusChange?.(null);
      }

      if (eng?.lipSyncRhythm) {
        eng.lipSyncRhythm.update();
        onRhythmStatusChange?.(eng.lipSyncRhythm.getStatus());
      } else {
        onRhythmStatusChange?.(null);
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, [onLipSyncStatusChange, onRhythmStatusChange]);

  // ─── 每帧管线（V2 Final Calibration 锁定顺序） ───
  useFrame((_, rawDelta) => {
    const eng = engineRef.current;
    if (!eng || !eng.vrm) return;

    const delta = sanitizeFrameDelta(rawDelta);

    // 1. 撤销上一帧程序化 LookAt 叠加
    eng.gaze.clear(eng.vrm);

    // 2. VRMA 写入当前动画基础姿态
    if (eng.animation) {
      eng.animation.tick(delta);
    }

    // 3. 在动画姿态之后叠加 Head/Neck/Spine LookAt
    eng.gaze.apply(eng.vrm, { x: gazeBus.x, y: gazeBus.y }, delta, activeVoidMotionRef.current);

    // 3b. headTilt（Z 轴 roll，与 gaze 的 X/Y 不同轴，canWrite 闸门保留）
    const head = eng.vrm.humanoid.getNormalizedBoneNode("head");
    if (head) {
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

    // 4. 表情写入（BlendShape + lean/tilt，canWrite 闸门）
    eng.expression.update(delta);

    // 5. 眨眼写入
    eng.blink.update(delta);

    // 6. VRM 内部 Humanoid / Expression / SpringBone 最终计算
    eng.vrm.update(delta);

    // 7. DEV 模式下按 1 秒间隔做只读稳定性扫描
    if (import.meta.env.DEV) {
      stabilityElapsedRef.current += delta;
      if (stabilityElapsedRef.current >= 1) {
        stabilityElapsedRef.current = 0;
        eng.stability.inspect(eng.vrm);
      }
    }
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
  const [agentSpeech, setAgentSpeech] = useState("");
  const [tts, setTts] = useState<BrowserTtsController | null>(null);
  const [lipProbe, setLipProbe] = useState<LipShapeProbeResult | null>(null);
  const [lipSyncStatus, setLipSyncStatus] = useState<LipSyncNoopStatus | null>(null);
  const [rhythmStatus, setRhythmStatus] = useState<LipSyncRhythmStatus | null>(null);

  return (
    <div className="avatar-vrm-stage">
      <Canvas
        camera={{ position: [0, VOID_AVATAR_PROFILE.fitHeight * 0.3, 5], fov: 35 }}
        gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
        style={{ width: "100%", height: "100%", background: "transparent" }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 5, 4]} intensity={1.3} />
        <directionalLight position={[-3, 2, -2]} intensity={0.45} />
        <Suspense fallback={null}>
          <VoidModel
            mood={mood}
            onAgentSpeech={setAgentSpeech}
            onTtsChange={setTts}
            onLipProbeChange={setLipProbe}
            onLipSyncStatusChange={setLipSyncStatus}
            onRhythmStatusChange={setRhythmStatus}
          />
        </Suspense>
      </Canvas>
      {agentSpeech ? (
        <div className="avatar-agent-speech">{agentSpeech}</div>
      ) : null}

      <AgentInputOverlay
        onSubmit={async (text) => {
          await window.__avatarOSAgent?.receiveText(text);
        }}
      />

      <VoiceControlOverlay tts={tts} lipProbe={lipProbe} />

      {lipSyncStatus ? (
        <div className="avatar-lip-sync-status">
          <div>
            LipSync: <strong>{lipSyncStatus.mode}</strong>
          </div>
          <div>
            shapes:{" "}
            {lipSyncStatus.availableShapes.length > 0
              ? lipSyncStatus.availableShapes.join(", ")
              : "none"}
          </div>
        </div>
      ) : null}

      {rhythmStatus ? (
        <div className="avatar-lip-rhythm-status">
          <div>
            Rhythm: <strong>{rhythmStatus.phase}</strong>
            {rhythmStatus.active ? (
              <span className="avatar-lip-rhythm-status__dot"> ●</span>
            ) : null}
          </div>
          <div>
            progress: {(rhythmStatus.progress * 100).toFixed(0)}%
          </div>
          <div>
            intensity: {rhythmStatus.intensity.toFixed(2)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
