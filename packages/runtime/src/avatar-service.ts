// ============================================================
// avatar-service — AvatarOS 身体所有权持有者 (v0.3.4-A)
// ============================================================
// 与 RuntimeKernel 平级的独立服务：
//   - RuntimeKernel 管"大脑"（认知 / 记忆 / 主动思考）
//   - 本服务管"身体"（当前激活的 avatar profile / 激活 / 恢复 / 订阅）
//
// 设计红线（与 BOSS 拍板一致）：
//   ❌ 不依赖 React / Canvas / Three.js / desktop 文件路径
//      → @avatar-os/runtime 不反向依赖 UI 或具体资产
//   ❌ 不持有 profile 目录（目录在 desktop catalog，避免 runtime 知道 bag/warrior 资产）
//   ✅ 只持有"当前激活的是谁"这一事实，并对外暴露订阅
//
// 真正的状态与变更权限封装在此类内部；UI 只能调用 activate(id)，
// 不能直接 load GLB。这把"身体所有权"从 React 隐式持有提升到 runtime 事实。

/** 激活身体 profile 的 id。desktop catalog 约束合法值（含 bag-character / fantasy-warrior / void-vrm）；产品默认 void-vrm（见 avatar-profiles DEFAULT_AVATAR_ID）。 */
export type AvatarId = string;

export interface AvatarServiceSnapshot {
  /** 当前激活的身体 profile id；恒非空（待机默认 void-vrm） */
  activeId: AvatarId;
}

type Listener = (snap: AvatarServiceSnapshot) => void;

export class AvatarService {
  private activeId: AvatarId;
  private readonly listeners = new Set<Listener>();
  private readonly defaultId: AvatarId;

  constructor(defaultId: AvatarId = "void-vrm") {
    this.defaultId = defaultId;
    this.activeId = defaultId;
  }

  getActiveId(): AvatarId {
    return this.activeId;
  }

  getSnapshot(): AvatarServiceSnapshot {
    return { activeId: this.activeId };
  }

  /**
   * 订阅激活变化。注册时立即推送当前值（便于 React 首帧对齐）。
   * 返回取消函数。
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 激活指定 profile。
   * 非法 id（目录里没有）由调用方负责回退为合法值后再调——
   * 本服务不持有目录（目录在 desktop catalog，避免 runtime 反向依赖资产）。
   * 仅当 id 与当前不同才通知订阅者。
   */
  activate(id: AvatarId): void {
    if (id === this.activeId) return;
    this.activeId = id;
    this.emit();
  }

  /** 从持久化 / 外部恢复激活状态（Phase C 的 AvatarStorageAdapter 调它）。 */
  restore(id: AvatarId | undefined): void {
    if (id === undefined) return;
    this.activeId = id;
    this.emit();
  }

  private emit(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((l) => l(snap));
  }
}
