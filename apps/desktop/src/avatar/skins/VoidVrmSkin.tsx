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
import { NEUTRAL_EMOTIONAL_STATE, Mood } from "@avatar-os/primitives";
import { gazeBus } from "./gazeBus";
import { loadVrm, disposeVrm } from "../vrm/load-vrm";
import { loadVrmActions, loadExtraVrmActions } from "../vrm/load-vrma";
import { GaitDriver, applyGait, restoreGait, facingYaw } from "../vrm/walk-cycle";
import {
  CUSTOM_MOTION_DIR,
  customMotionRegistry,
  loadCustomMotionManifest,
  pickIdleMotion,
  type CustomMotion,
} from "../custom-motions";
import { DesktopWalker, locomotionBus } from "../../companion/desktop-walker";
import { createTauriWindowPort } from "../../platform/tauri-window-port";
import { VrmBlinkController } from "../vrm/VrmBlinkController";
import { VrmExpressionController } from "../vrm/VrmExpressionController";
import { VrmGazeController } from "../vrm/VrmGazeController";
import { VrmStabilityGuard } from "../vrm/VrmStabilityGuard";
import { VOID_CALIBRATION, validateVoidCalibration } from "../void-calibration";
import { getVoidMotionSemantic, isVoidMotionId, validateVoidMotionSemantics } from "../void-motion-semantics";
import {
  validateVoidV2RuntimeGate,
  assertVoidV2RuntimeGate,
  formatVoidV2GateResult,
} from "../void-v2-stability-gate";
import { calculateVisibleMeshFrame, type VrmFrameTransform } from "../vrm/vrm-framing";
import { VOID_AVATAR_PROFILE } from "../void-avatar-profile";
import type { SkinProps } from "./types";
import { useAdvancedDebug } from "../../demo/demo-runtime";
import { DemoStatusBar } from "../../demo/DemoStatusBar";
import { localFetch } from "../../platform/local-fetch";
import { companionSettings } from "../../companion/companion-settings";
import { CompanionBrain } from "../../companion/companion-brain";
import { conversationStore } from "../../companion/conversation-store";
import { markUserActivity } from "../../companion/activity";
import { useCompanionSettings } from "../../companion/useCompanionSettings";
import { CompanionSettingsPanel } from "../../companion/CompanionSettingsPanel";
import { CompanionVoice } from "../../companion/cloud-voice";
import {
  AgentInputOverlay,
  AgentRuntime,
  BrowserTtsController,
  LipSyncNoopHarness,
  LipSyncTextRhythmDriver,
  TextVisemeExpressionDriver,
  LipSyncControlOverlay,
  VoiceControlOverlay,
  ConversationMemory,
  isStatusReportingBrain,
  probeLipShapes,
  type AgentBrain,
  type BrainStatus,
  type AgentBodyBridge,
  type AgentEmotion,
  type AgentIntent,
  type LipShapeProbeResult,
  type LipSyncNoopStatus,
  type LipSyncRhythmStatus,
  type TextVisemeExpressionDriverStatus,
} from "../agent";

declare global {
  interface Window {
    __avatarOSAgent?: {
      receiveText(text: string): Promise<unknown>;
      interrupt(): void;
      snapshot(): unknown;
      clearMemory(): void;
      reprobe(): Promise<BrainStatus | null>;
      /** 调试：立刻走两步（Tauri 内真的移动窗口；浏览器里原地踏步 4 秒） */
      walk(): Promise<boolean>;
      /** 调试：播放一个招牌动作 */
      playMotion(id: string): boolean;
      /** 已加载的招牌动作 */
      customMotions(): readonly CustomMotion[];
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
  textVisemeExpression?: TextVisemeExpressionDriver;
  brain?: AgentBrain;
  memory?: ConversationMemory;
  /** 智能体占用身体的截止时刻（思考中=Infinity）；在此之前生命状态 mood 不覆盖表情 */
  busyUntil: number;
  unbindProactive?: () => void;
  unbindSettings?: () => void;
  /** 朗读门面：克隆声音（云端）/ 系统语音，负责在出声时启动嘴型 */
  voice?: CompanionVoice;
  /** 已成功加载的招牌动作 id */
  customMotionIds: Set<string>;
  /** 走路步态 + 上一帧叠加的骨骼（下一帧开头撤销） */
  gait: GaitDriver;
  gaitSaved: Array<[THREE.Object3D, THREE.Quaternion]>;
  walker?: DesktopWalker;
  stopIdleActivity?: () => void;
}

/**
 * 说一句话：朗读 + 嘴型。嘴型在声音真正开始时才启动（云端合成有网络延迟），
 * 云端音频播完即收嘴；系统语音沿用原有文本节奏。
 */
function speakWithBody(eng: VrmEngine, text: string): void {
  const startLip = () => {
    eng.busyUntil = Date.now() + estimateSpeechHoldMs(text);
    eng.lipSyncNoop?.notifySpeechText(text);
    eng.lipSyncRhythm?.startText(text);
    eng.textVisemeExpression?.startText(text);
  };
  if (eng.voice) {
    void eng.voice.speak(text, {
      onStart: startLip,
      onEnd: () => {
        eng.lipSyncRhythm?.cancel();
        eng.textVisemeExpression?.cancel(eng.vrm?.expressionManager);
      },
    });
  } else {
    eng.tts?.speak(text);
    startLip();
  }
}

/** 说完一句话后保留表情 / 气泡的时长估算（中文约 4.5 字/秒 + 余量） */
export function estimateSpeechHoldMs(text: string): number {
  return Math.min(15000, 2500 + text.length * 220);
}

/**
 * 生命状态（LifeLoop / AvatarFSM 的 Mood）→ VOID 具名表情预设。
 * 只在智能体空闲时生效：说话 / 思考期间由 AgentRuntime 的 emotion 主导。
 */
export function applyMoodExpression(expression: VrmExpressionController, mood: Mood): void {
  switch (mood) {
    case Mood.HAPPY:
    case Mood.EXCITED:
    case Mood.PLAYFUL:
      expression.happy();
      return;
    case Mood.SAD:
    case Mood.LONELY:
      expression.sad();
      return;
    case Mood.TIRED:
    case Mood.SLEEPING:
      expression.drowsy();
      return;
    case Mood.CURIOUS:
      expression.thinking();
      return;
    case Mood.CALM:
    case Mood.FOCUSED:
    default:
      expression.idle();
  }
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

    // 招牌动作没有内置语义：按"打招呼"类处理（视线叠加减弱，播完回待机）
    activeMotionRef.current = isVoidMotionId(name) ? getVoidMotionSemantic(name).id : "GREET";

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
  setThinkingUi: (thinking: boolean) => void,
  tts?: BrowserTtsController,
  lipSyncNoop?: LipSyncNoopHarness,
  lipSyncRhythm?: LipSyncTextRhythmDriver,
  textVisemeExpression?: TextVisemeExpressionDriver,
): AgentBodyBridge {
  return {
    speakText(text: string): void {
      eng.busyUntil = Date.now() + estimateSpeechHoldMs(text);
      setAgentSpeech(text);
      speakWithBody(eng, text);
    },

    setThinking(thinking: boolean): void {
      setThinkingUi(thinking);
      if (thinking) {
        eng.busyUntil = Number.POSITIVE_INFINITY;
        eng.expression?.thinking();
      } else if (eng.busyUntil === Number.POSITIVE_INFINITY) {
        eng.busyUntil = Date.now();
      }
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

    playMotion(motionId: string): boolean {
      const id = motionId.toUpperCase();
      if (!eng.animation || !eng.customMotionIds.has(id)) return false;
      eng.walker?.interrupt();
      eng.animation.playOnce(id);
      return true;
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
      if (eng.voice) eng.voice.cancel();
      else tts?.cancel();
      lipSyncNoop?.cancel();
      lipSyncRhythm?.cancel();
      textVisemeExpression?.cancel(eng.vrm?.expressionManager);
      eng.animation?.play("IDLE");
      eng.busyUntil = Date.now();
      setAgentSpeech("");
    },
  };
}

/** 疲惫 / 睡着时不走动、不做招牌动作 */
const QUIET_MOODS = new Set<string>([Mood.TIRED, Mood.SLEEPING]);

/**
 * 闲时活动调度：走动（仅 Tauri）+ 空闲招牌动作。
 * 条件：⚙ 开关打开、智能体空闲、没在播别的动作、她最近 10 秒没点击 / 打字、不是困倦状态。
 * 她一按鼠标或开始打字，正在走的路立刻停下。返回清理函数。
 */
function startIdleActivity(
  eng: VrmEngine,
  getMood: () => SkinProps["mood"],
  activeMotionRef: MutableRefObject<string>,
): () => void {
  let lastUserInput = 0;
  const onUserInput = () => {
    lastUserInput = Date.now();
    eng.walker?.interrupt();
  };
  window.addEventListener("mousedown", onUserInput, true);
  window.addEventListener("keydown", onUserInput, true);

  const idleNow = () =>
    companionSettings.get().idleActivityEnabled &&
    Date.now() >= eng.busyUntil &&
    Date.now() - lastUserInput > 10_000 &&
    activeMotionRef.current === "IDLE" &&
    !QUIET_MOODS.has(getMood());

  const port = createTauriWindowPort();
  if (port) {
    eng.walker = new DesktopWalker({ port, canWalk: idleNow });
    eng.walker.start();
  }

  // 招牌动作：空闲时每 6–15 分钟可能做一次（只挑 idleWeight > 0 的）
  const nextDelay = () => Math.round((6 + Math.random() * 9) * 60_000);
  let nextMotionAt = Date.now() + nextDelay();
  const motionTimer = window.setInterval(() => {
    if (Date.now() < nextMotionAt) return;
    if (!eng.animation || eng.walker?.isWalking() || !idleNow()) return;
    nextMotionAt = Date.now() + nextDelay();
    const m = pickIdleMotion(customMotionRegistry.motions);
    if (m && eng.customMotionIds.has(m.id)) eng.animation.playOnce(m.id);
  }, 15_000);

  return () => {
    window.removeEventListener("mousedown", onUserInput, true);
    window.removeEventListener("keydown", onUserInput, true);
    window.clearInterval(motionTimer);
    eng.walker?.stop();
    eng.walker = undefined;
    customMotionRegistry.motions = [];
  };
}

/**
 * 内部模型组件 —— 挂载 VRM 到 R3F 场景，驱动每帧管线
 */
function VoidModel({
  mood,
  onAgentSpeech,
  onTtsChange,
  onVoiceChange,
  onLipProbeChange,
  onLipSyncStatusChange,
  onRhythmStatusChange,
  onTextVisemeStatusChange,
  onVrmLoadedChange,
  onBrainStatusChange,
  onThinkingChange,
  engineRef,
}: {
  mood: SkinProps["mood"];
  onAgentSpeech: (text: string) => void;
  onBrainStatusChange?: (status: BrainStatus | null) => void;
  onThinkingChange?: (thinking: boolean) => void;
  onTtsChange?: (tts: BrowserTtsController | null) => void;
  onVoiceChange?: (voice: CompanionVoice | null) => void;
  onLipProbeChange?: (result: LipShapeProbeResult | null) => void;
  onLipSyncStatusChange?: (status: LipSyncNoopStatus | null) => void;
  onRhythmStatusChange?: (status: LipSyncRhythmStatus | null) => void;
  onTextVisemeStatusChange?: (status: TextVisemeExpressionDriverStatus | null) => void;
  onVrmLoadedChange?: (loaded: boolean) => void;
  engineRef: MutableRefObject<VrmEngine | null>;
}) {
  const [vrm, setVrm] = useState<import("@pixiv/three-vrm").VRM | null>(null);
  const containerRef = useRef<THREE.Group>(null);
  const stabilityElapsedRef = useRef(0);
  const activeVoidMotionRef = useRef<string>("IDLE");
  const [frame, setFrame] = useState<VrmFrameTransform | null>(null);
  // 生命状态 mood：用 ref 供轮询读取，避免重装引擎
  const moodRef = useRef<SkinProps["mood"]>(mood);
  moodRef.current = mood;
  const appliedMoodRef = useRef<SkinProps["mood"] | null>(null);

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
        onVrmLoadedChange?.(true);
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
      let customMotionsLoaded: CustomMotion[] = [];
      const actionUrls = VOID_AVATAR_PROFILE.actions;

      if (Object.keys(actionUrls).length > 0) {
        try {
          const loaded = await loadVrmActions(
            vrm,
            actionUrls,
            VOID_AVATAR_PROFILE.rootMotionMode,
          );

          // 招牌动作（可选）：custom/motions.json 登记的 .vrma，坏一个跳一个，不影响内置动作
          const manifest = await loadCustomMotionManifest();
          if (manifest.motions.length > 0) {
            const extra = await loadExtraVrmActions(
              vrm,
              loaded.mixer,
              Object.fromEntries(manifest.motions.map((m) => [m.id, CUSTOM_MOTION_DIR + m.file])),
              VOID_AVATAR_PROFILE.rootMotionMode,
            );
            Object.assign(loaded.actions, extra.actions);
            customMotionsLoaded = manifest.motions.filter((m) => extra.actions[m.id]);
            if (Object.keys(extra.failed).length > 0) {
              console.warn("[VOID] 招牌动作加载失败（已跳过）：", extra.failed);
            }
          }
          if (manifest.skipped.length > 0) {
            console.warn("[VOID] motions.json 中被跳过的条目：", manifest.skipped);
          }

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
        busyUntil: 0,
        customMotionIds: new Set(customMotionsLoaded.map((m) => m.id)),
        gait: new GaitDriver(),
        gaitSaved: [],
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
      // 朗读门面：⚙ 里配置了克隆声音就用你的声音，否则系统语音（设置实时读取，改了立即生效）
      const voice = new CompanionVoice({
        browserTts: tts,
        getSettings: () => companionSettings.get(),
        fetchImpl: localFetch,
      });
      engine.voice = voice;
      onVoiceChange?.(voice);

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

      // 7e. Day9-OneShot Text Viseme Expression Driver：唯一嘴型写入口。
      //     文本 viseme 时间线（不接音频）→ 白名单 aa/ih/ou/ee/oh → 安全 setValue。
      const textVisemeExpression = new TextVisemeExpressionDriver();
      if (engine.lipShapeProbe) {
        textVisemeExpression.setProbeAvailable(
          engine.lipShapeProbe.available,
          engine.vrm?.expressionManager,
        );
      }
      engine.textVisemeExpression = textVisemeExpression;

      const agentBody = createVoidAgentBodyBridge(
        engine,
        (text) => {
          // 智能体说话 / 被打断后，让生命状态 mood 在空闲时重新接管表情
          appliedMoodRef.current = null;
          onAgentSpeech(text);
        },
        (thinking) => onThinkingChange?.(thinking),
        tts,
        lipSyncNoop,
        lipSyncRhythm,
        textVisemeExpression,
      );
      // 多轮对话记忆（全局 conversationStore，localStorage 持久化；主动陪伴也读写它）
      // 大脑按 ⚙ 陪伴设置实时切换：云端 / 本机 Ollama / 离线规则；人设与当前时间每次现算
      const memory = conversationStore;
      const brain = new CompanionBrain({ store: companionSettings, memory, fetchImpl: localFetch });
      engine.memory = memory;
      engine.brain = brain;
      void brain.probe().then((st) => {
        if (!cancelled) onBrainStatusChange?.(st);
      });
      // 设置变化（换厂商 / 改 Key）→ 防抖后重新探测，Brain 灯随之更新
      let reprobeTimer: number | undefined;
      const unsubscribeSettings = companionSettings.subscribe(() => {
        window.clearTimeout(reprobeTimer);
        reprobeTimer = window.setTimeout(() => {
          void brain.reprobe().then((st) => onBrainStatusChange?.(st));
        }, 800);
      });
      engine.unbindSettings = () => {
        window.clearTimeout(reprobeTimer);
        unsubscribeSettings();
      };

      const agentRuntime = new AgentRuntime(brain, agentBody);
      engine.agentRuntime = agentRuntime;

      // 主动陪伴（RuntimeKernel → CognitionEngine → AVATAR_THOUGHT kind=speech）：
      // 显示在和聊天回复同一个对话框里（不是头顶小气泡），并朗读 + 嘴型 + 记入对话记忆。
      // 智能体正在思考 / 说话时不插话。
      engine.unbindProactive = kernelEventBus.on("AVATAR_THOUGHT", (p) => {
        if (p.kind !== "speech" || !p.text) return;
        // 头顶 ThoughtBubble 也订阅了这条事件；下一拍清掉它，避免同一句话显示两遍
        queueMicrotask(() => kernelEventBus.emit("AVATAR_THOUGHT", { kind: "clear" }));
        if (Date.now() < engine.busyUntil) return;
        engine.busyUntil = Date.now() + estimateSpeechHoldMs(p.text);
        appliedMoodRef.current = null;
        onAgentSpeech(p.text);
        speakWithBody(engine, p.text);
        memory.append("assistant", p.text);
      });
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
        clearMemory() {
          memory.clear();
        },
        async reprobe() {
          return brain.reprobe();
        },
        async walk() {
          if (engine.walker) return engine.walker.strollNow();
          // 浏览器预览没有窗口可移动：原地踏步 4 秒，用来看步态
          locomotionBus.walking = true;
          locomotionBus.direction = 1;
          locomotionBus.speed = 55;
          window.setTimeout(() => {
            locomotionBus.walking = false;
            locomotionBus.direction = 0;
            locomotionBus.speed = 0;
          }, 4000);
          return true;
        },
        playMotion(id: string) {
          return agentBody.playMotion?.(id) ?? false;
        },
        customMotions() {
          return customMotionRegistry.motions;
        },
      };

      // 9. 闲时活动：在桌面上走走 / 偶尔做个招牌动作（⚙ 可关）
      customMotionRegistry.motions = customMotionsLoaded;
      engine.stopIdleActivity = startIdleActivity(engine, () => moodRef.current, activeVoidMotionRef);

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
        eng.unbindProactive?.();
        eng.stopIdleActivity?.();
        restoreGait(eng.gaitSaved);
        eng.unbindSettings?.();
        eng.voice?.dispose();
        eng.tts?.dispose();
        eng.lipSyncNoop?.cancel();
        eng.lipSyncRhythm?.cancel();
        eng.textVisemeExpression?.cancel(eng.vrm?.expressionManager);
        eng.bridge.disconnect();
        eng.gaze.dispose(eng.vrm);
        disposeVrm(eng.vrm);
      }
      engineRef.current = null;
      onTtsChange?.(null);
      onVoiceChange?.(null);
      onLipProbeChange?.(null);
      onLipSyncStatusChange?.(null);
      onRhythmStatusChange?.(null);
      onTextVisemeStatusChange?.(null);
      onBrainStatusChange?.(null);
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

      if (eng?.textVisemeExpression) {
        onTextVisemeStatusChange?.(eng.textVisemeExpression.getStatus());
      } else {
        onTextVisemeStatusChange?.(null);
      }

      // 大脑真实状态（LLM / 规则回退）
      if (eng?.brain && isStatusReportingBrain(eng.brain)) {
        onBrainStatusChange?.(eng.brain.getStatus());
      }

      // 生命状态 → 表情：仅在智能体空闲且 mood 有变化时写入（不与说话表情抢）
      if (eng && Date.now() >= eng.busyUntil && appliedMoodRef.current !== moodRef.current) {
        applyMoodExpression(eng.expression, moodRef.current);
        appliedMoodRef.current = moodRef.current;
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, [onLipSyncStatusChange, onRhythmStatusChange, onTextVisemeStatusChange, onBrainStatusChange]);

  // ─── 每帧管线（V2 Final Calibration 锁定顺序） ───
  useFrame((_, rawDelta) => {
    const eng = engineRef.current;
    if (!eng || !eng.vrm) return;

    const delta = sanitizeFrameDelta(rawDelta);

    // 1. 撤销上一帧程序化 LookAt 叠加，再撤销上一帧走路步态（与叠加顺序相反）
    eng.gaze.clear(eng.vrm);
    restoreGait(eng.gaitSaved);

    // 2. VRMA 写入当前动画基础姿态
    if (eng.animation) {
      eng.animation.tick(delta);
    }

    // 2b. 走路：在动画姿态上叠加步态，身体转向行进方向（停下转回正面）
    eng.gaitSaved = applyGait(
      eng.vrm,
      eng.gait.update(locomotionBus.walking, locomotionBus.speed, delta),
    );
    const group = containerRef.current;
    if (group) {
      const targetYaw = VOID_AVATAR_PROFILE.rotationY + facingYaw(locomotionBus.walking ? locomotionBus.direction : 0);
      group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, targetYaw, Math.min(1, delta * 6));
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

      // 5b. Day9-OneShot Text Viseme Expression Driver（唯一嘴型写入口）：
      //     每帧用文本 viseme 时间线驱动嘴型（不接音频），
      //     三闸门未全开时 writer 内部 no-op / 归零。Day8 rhythm 仅用于 UI 显示。
      eng.textVisemeExpression?.update(eng.vrm?.expressionManager, delta);

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
  const [voice, setVoice] = useState<CompanionVoice | null>(null);
  const [lipProbe, setLipProbe] = useState<LipShapeProbeResult | null>(null);
  const [lipSyncStatus, setLipSyncStatus] = useState<LipSyncNoopStatus | null>(null);
  const [rhythmStatus, setRhythmStatus] = useState<LipSyncRhythmStatus | null>(null);
  const [textVisemeStatus, setTextVisemeStatus] = useState<TextVisemeExpressionDriverStatus | null>(null);
  const engineRef = useRef<VrmEngine | null>(null);
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [thinking, setThinking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const companion = useCompanionSettings();
  const displayName = companion.companionName.trim() || "VOID";

  // 输入栏（含设置按钮）平时隐藏：鼠标移到小人身上时出现，离开 2.5 秒后收起；
  // 正在输入 / 等回复 / 开着设置时保持显示。桌面上大部分时间只看到人。
  const [hovering, setHovering] = useState(false);
  const [inputActive, setInputActive] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const onStageEnter = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setHovering(true);
  };
  const onStageLeave = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovering(false), 2500);
  };
  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  }, []);
  const dockVisible = hovering || inputActive || thinking || settingsOpen;

  // 回话气泡：按文本长度自动淡出（此前会永久停留在角色身上）
  useEffect(() => {
    if (!agentSpeech) return;
    const handle = window.setTimeout(() => setAgentSpeech(""), estimateSpeechHoldMs(agentSpeech));
    return () => window.clearTimeout(handle);
  }, [agentSpeech]);

  // Day15A：演示模式开关（仅控制调试可见性，不碰音频/表情/嘴型算法）
  const showDebug = useAdvancedDebug();
  const [brainReady, setBrainReady] = useState(false);
  const brainState: "ok" | "warn" | "wait" = !brainReady
    ? "wait"
    : brainStatus?.source === "llm"
      ? "ok"
      : brainStatus?.source === "fallback"
        ? "warn"
        : "wait";
  const brainTitle =
    brainStatus?.source === "llm"
      ? `大脑：${brainStatus.provider} 在线`
      : brainStatus?.source === "fallback"
        ? `大脑：${brainStatus.provider} 不可用，暂用固定回复（${brainStatus.lastError ?? "未知原因"}）`
        : "大脑：探测中";
  const ttsAvailable = !!tts && tts.getStatus().available;
  const lipAvailable = !!lipProbe && lipProbe.available;
  const [vrmLoaded, setVrmLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const agent = (window as unknown as { __avatarOSAgent?: unknown }).__avatarOSAgent;
      setBrainReady(Boolean(agent));
      if (!agent) {
        window.setTimeout(check, 400);
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="avatar-vrm-stage"
      onMouseEnter={onStageEnter}
      onMouseMove={hovering ? undefined : onStageEnter}
      onMouseLeave={onStageLeave}
    >
      {showDebug ? (
        <DemoStatusBar
          vrmLoaded={vrmLoaded}
          brainReady={brainReady}
          brainState={brainState}
          brainTitle={brainTitle}
          ttsAvailable={ttsAvailable}
          lipAvailable={lipAvailable}
          viteConnected={import.meta.env.DEV}
        />
      ) : null}
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
            onVoiceChange={setVoice}
            onLipProbeChange={setLipProbe}
            onLipSyncStatusChange={setLipSyncStatus}
            onRhythmStatusChange={setRhythmStatus}
            onTextVisemeStatusChange={setTextVisemeStatus}
            onVrmLoadedChange={setVrmLoaded}
            onBrainStatusChange={setBrainStatus}
            onThinkingChange={setThinking}
            engineRef={engineRef}
          />
        </Suspense>
      </Canvas>
      {thinking || agentSpeech ? (
        <div
          key={thinking ? "thinking" : agentSpeech}
          className={"avatar-agent-speech" + (thinking ? " avatar-agent-speech--thinking" : "")}
          aria-live="polite"
        >
          <span className="avatar-agent-speech__from">{displayName}</span>
          {thinking ? (
            <span className="avatar-thinking-dots" aria-label="正在想"><i /><i /><i /></span>
          ) : (
            <span className="avatar-agent-speech__text">{agentSpeech}</span>
          )}
        </div>
      ) : null}

      <div className={"avatar-dock" + (dockVisible ? " is-visible" : "")} aria-hidden={!dockVisible}>
        {/* 用户主动选了"离线固定回复"不算故障，不提示 */}
        {brainState === "warn" && companion.brainMode !== "rule" ? (
          <p className="avatar-dock__notice" title={brainTitle}>
            连不上大模型，先用固定回复。打开设置点「测试连接」看原因。
          </p>
        ) : null}
        <AgentInputOverlay
          placeholder={`和 ${displayName} 说句话`}
          onActiveChange={setInputActive}
          leading={
            <button
              type="button"
              className={"avatar-settings-toggle" + (settingsOpen ? " avatar-settings-toggle--active" : "")}
              title={settingsOpen ? "收起设置" : "设置"}
              aria-label="设置"
              aria-expanded={settingsOpen}
              tabIndex={dockVisible ? 0 : -1}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M11.1 2.2a1 1 0 0 0-2.2 0l-.2 1.4a6.6 6.6 0 0 0-1.6.7l-1.2-.8a1 1 0 0 0-1.5 1.5l.8 1.2c-.3.5-.5 1-.7 1.6l-1.4.2a1 1 0 0 0 0 2.2l1.4.2c.2.6.4 1.1.7 1.6l-.8 1.2a1 1 0 0 0 1.5 1.5l1.2-.8c.5.3 1 .5 1.6.7l.2 1.4a1 1 0 0 0 2.2 0l.2-1.4c.6-.2 1.1-.4 1.6-.7l1.2.8a1 1 0 0 0 1.5-1.5l-.8-1.2c.3-.5.5-1 .7-1.6l1.4-.2a1 1 0 0 0 0-2.2l-1.4-.2a6.6 6.6 0 0 0-.7-1.6l.8-1.2a1 1 0 0 0-1.5-1.5l-1.2.8a6.6 6.6 0 0 0-1.6-.7zM10 12.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z"
                />
              </svg>
            </button>
          }
          onSubmit={async (text) => {
            markUserActivity();
            await window.__avatarOSAgent?.receiveText(text);
            markUserActivity();
          }}
        />
      </div>

      {settingsOpen ? (
        <div className="avatar-settings-drawer" role="dialog" aria-label="设置">
          <CompanionSettingsPanel
            memoryCount={engineRef.current?.memory?.size() ?? conversationStore.size()}
            onClearMemory={() => window.__avatarOSAgent?.clearMemory()}
            onPreviewVoice={async (text) => {
              if (!voice) throw new Error("声音模块还没准备好，稍后再试");
              await voice.preview(text);
            }}
            onTestConnection={async () => {
              const st = (await window.__avatarOSAgent?.reprobe()) ?? null;
              if (st) setBrainStatus(st);
              return st;
            }}
          />
          <VoiceControlOverlay tts={tts} lipProbe={lipProbe} showDebug={showDebug} />
          <LipSyncControlOverlay
            driver={engineRef.current?.textVisemeExpression ?? null}
            getManager={() => engineRef.current?.vrm?.expressionManager ?? null}
            status={textVisemeStatus}
            lipProbe={lipProbe}
            showDebug={showDebug}
          />
        </div>
      ) : null}

      {showDebug && lipSyncStatus ? (
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

      {showDebug && rhythmStatus ? (
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

      {showDebug && textVisemeStatus ? (
        <div className="avatar-text-viseme-status">
          <div>
            Text Viseme:{" "}
            <strong>
              {textVisemeStatus.writer.active ? "active" : "idle"}
            </strong>
          </div>
          <div>
            shape:{" "}
            {textVisemeStatus.writer.currentShape ?? "none"} /{" "}
            {textVisemeStatus.writer.currentWeight.toFixed(2)}
          </div>
          <div>
            frame:{" "}
            {textVisemeStatus.frame.phase} /{" "}
            {(textVisemeStatus.frame.progress * 100).toFixed(0)}%
          </div>
          <div>
            reset: {textVisemeStatus.writer.resetCount}
          </div>
        </div>
      ) : null}
    </div>
  );
}
