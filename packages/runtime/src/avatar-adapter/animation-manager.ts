import * as THREE from "three";

export interface AnimationManagerOptions {
  /** 默认循环片段（Idle/待机），playOnce 播完自动回它 */
  idleClip: string;
  /** 交叉淡入淡出时长（秒） */
  fade?: number;
}

/**
 * 动画管理器 —— 统一接管模型自带的 Animation Clip，提供平滑过渡(CrossFade)能力。
 *
 * 与渲染层解耦：它只认「一个根 Object3D + 一组 AnimationClip」，
 * 不关心这是 bag character、RobotExpressive 还是未来的 VRM。
 * 片段名由外部配置(RigConfig)注入 —— 因为 AI/Tripo 导出的 GLB
 * 常常残留 NlaTrack/NlaTrack.001 这种无语义名，绝不能硬编码 "idle/wave/walk"。
 */
export class AnimationManager {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private active: THREE.AnimationAction | null = null;
  private idleClip: string;
  private fade: number;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], opts: AnimationManagerOptions) {
    this.mixer = new THREE.AnimationMixer(root);
    this.idleClip = opts.idleClip;
    this.fade = opts.fade ?? 0.3;

    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      // 原始名 + 大小写不敏感别名，便于按近似名检索
      this.actions.set(clip.name, action);
      this.actions.set(clip.name.toLowerCase(), action);
    }
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
  }

  /** 单次播放（意图/状态触发的一次性动作），播完平滑回 idle */
  public playOnce(name: string, onFinished?: () => void): void {
    const action = this.resolve(name);
    if (!action) return;
    if (this.active && this.active !== action) this.active.fadeOut(this.fade);
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(this.fade).play();
    this.active = action;

    const mixer = this.mixer;
    const done = () => {
      mixer.removeEventListener("finished", done);
      this.play(this.idleClip);
      onFinished?.();
    };
    mixer.addEventListener("finished", done);
  }

  /** 每帧推进混合器（由渲染层 useFrame 调用） */
  public tick(delta: number): void {
    this.mixer.update(delta);
  }

  private resolve(name: string): THREE.AnimationAction | undefined {
    return this.actions.get(name) ?? this.actions.get(name.toLowerCase());
  }
}
