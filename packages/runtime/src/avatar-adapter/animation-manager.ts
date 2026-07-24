import * as THREE from "three";
import { buildAnimationOwnershipMap, type AnimationOwnershipMap } from "./animation-channel-scanner";
import { kernelEventBus } from "../event-bus";

/** v0.3.4-B+ Phase 2.2：Animation 生命周期事件。AnimationManager 只负责「发生了什么」，不认识 Authority。 */
export type AnimationEvent = {
  type: "started" | "finished";
  /** 触发事件的 clip 原名（如 "NlaTrack.002"） */
  clip: string;
};

export interface AnimationManagerOptions {
  /** 默认循环片段（Idle/待机），playOnce 播完自动回它 */
  idleClip: string;
  /** 交叉淡入淡出时长（秒） */
  fade?: number;
}

/**
 * 动画管理器 —— 统一接管模型自带的 Animation Clip，提供平滑过渡(CrossFade)能力。
 *
 * 与渲染层解耦：它只认「一个 AnimationMixer + 一组已建好的 AnimationAction」，
 * 不关心这是 bag character、RobotExpressive 还是未来的 VRM。
 * 片段名由外部配置(RigConfig)注入 —— 因为 AI/Tripo 导出的 GLB
 * 常常残留 NlaTrack/NlaTrack.001 这种无语义名，绝不能硬编码 "idle/wave/walk"。
 *
 * 采用 R3F 惯用形态：由 useAnimations 产出 mixer + actions 后注入，
 * 而非自己 new Mixer —— 避免与 drei 缓存的 scene 重复建 mixer 导致动画不播。
 */
export class AnimationManager {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private active: THREE.AnimationAction | null = null;
  private idleClip: string;
  private fade: number;
  /** Phase 2.2：clip 生命周期事件订阅者（AnimationManager 不认识 Authority，只广播事件） */
  private listeners = new Set<(e: AnimationEvent) => void>();

  constructor(
    mixer: THREE.AnimationMixer,
    actions: Record<string, THREE.AnimationAction>,
    opts: AnimationManagerOptions,
  ) {
    this.mixer = mixer;
    this.idleClip = opts.idleClip;
    this.fade = opts.fade ?? 0.3;

    for (const [name, action] of Object.entries(actions)) {
      // 原始名 + 大小写不敏感别名，便于按近似名检索
      this.actions.set(name, action);
      this.actions.set(name.toLowerCase(), action);
    }
  }

  /**
   * Phase 2.2：订阅 clip 生命周期事件（started / finished）。
   * 返回取消订阅函数。AnimationManager 不持有 Authority —— 调用方（Runtime 装配层）
   * 负责把事件转译为 Authority.setOwner / clearOwner。
   */
  public subscribe(listener: (e: AnimationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 广播一个生命周期事件给所有订阅者（无订阅者时为空操作） */
  private emit(event: AnimationEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** 是否存在某片段（大小写不敏感） */
  public has(name: string): boolean {
    return this.actions.has(name) || this.actions.has(name.toLowerCase());
  }

  /** 循环播放（待机/持续动作），带 CrossFade */
  public play(name: string): void {
    const action = this.resolve(name);
    if (!action || action === this.active) return;
    action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(this.fade).play();
    if (this.active && this.active !== action) this.active.fadeOut(this.fade);
    this.active = action;
    const clip = action.getClip();
    if (clip) this.emit({ type: "started", clip: clip.name });
  }

  /** 单次播放（意图/状态触发的一次性动作），播完平滑回 idle */
  public playOnce(name: string, onFinished?: () => void): void {
    const action = this.resolve(name);
    if (!action) return;
    if (this.active && this.active !== action) this.active.fadeOut(this.fade);
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(this.fade).play();
    this.active = action;
    const clip = action.getClip();
    if (clip) {
      this.emit({ type: "started", clip: clip.name });
      // v0.3.6-A：广播"片段正在播放"给调度器，使其期间不插入自主动作（防动作抢身体）。
      // 仅在 playOnce（一次性片段）广播；play(idleClip) 的循环不广播，避免误阻塞。
      kernelEventBus.emit("ANIMATION_CLIP_STATE", { playing: true, clip: clip.name });
    }

    const mixer = this.mixer;
    const finishedClip = clip ? clip.name : name;
    const done = () => {
      mixer.removeEventListener("finished", done);
      this.emit({ type: "finished", clip: finishedClip });
      // v0.3.6-A：片段播完 → 通知调度器恢复阶段默认意图（"恢复站姿"）。
      kernelEventBus.emit("ANIMATION_CLIP_STATE", { playing: false, clip: finishedClip });
      this.play(this.idleClip);
      onFinished?.();
    };
    mixer.addEventListener("finished", done);
  }

  /** 每帧推进混合器（由渲染层 useFrame 调用） */
  public tick(delta: number): void {
    this.mixer.update(delta);
  }

  /**
   * v0.3.4-B+ Phase 1：Animation Capability Discovery。
   * 扫描当前所有已注册 clip 的 tracks，推导每个 clip 会写入哪些「骨骼.通道」。
   * 纯只读、不接仲裁、不改变任何播放/写入行为。结果供 Phase 2 Ownership Runtime
   * 查询（当前系统第一次「知道」一个动画碰哪些自由度）。
   * actions 含原名+小写别名指向同一 AnimationAction，故按 clip.uuid 去重。
   */
  public discoverOwnership(): AnimationOwnershipMap {
    const clips: THREE.AnimationClip[] = [];
    const seen = new Set<string>();
    for (const action of this.actions.values()) {
      const clip = action.getClip();
      if (!clip) continue;
      if (seen.has(clip.uuid)) continue;
      seen.add(clip.uuid);
      clips.push(clip);
    }
    return buildAnimationOwnershipMap(clips);
  }

  private resolve(name: string): THREE.AnimationAction | undefined {
    return this.actions.get(name) ?? this.actions.get(name.toLowerCase());
  }
}
