// ============================================================
// Relationship Repository (v0.3.7-A) — 持久化窄接口
// ============================================================
// RelationshipEngine 保持纯逻辑；具体存储放在基础设施层。
// 本文件只定义契约：持久化协调器依赖 FileAccess（可注入内存 / Tauri / 其它实现），
// 绝不 import Tauri / 浏览器 / Node 文件系统。
// ============================================================

import type { RelationshipState, RelationshipHistory } from "./relationship-state";

/** 持久化载体：关系状态 + 历史 + schema 版本。 */
export interface PersistedRelationship {
  state: RelationshipState;
  history: RelationshipHistory;
  schemaVersion: number;
}

/**
 * 文件访问窄接口：持久化协调器只依赖此接口，不碰 Tauri / 浏览器 / Node。
 * 桌面端提供基于 @tauri-apps/plugin-fs 的实现；测试提供内存实现。
 */
export interface FileAccess {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/**
 * 关系仓储接口（窄）。生命周期：
 *   load()           启动加载（文件缺失 → neutral；损坏 → 安全回退 neutral）
 *   scheduleSave(v)  有效变化后调用，内部防抖
 *   flush()          退出 / 关闭时尽量刷新，等待在途写入
 */
export interface RelationshipRepository {
  load(): Promise<PersistedRelationship | null>;
  scheduleSave(value: PersistedRelationship): void;
  flush(): Promise<void>;
}
