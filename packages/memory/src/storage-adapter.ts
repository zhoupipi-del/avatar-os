/**
 * Storage Adapter — 真实本地持久化抽象层
 *
 * 设计：MemoryStore 依赖 StorageAdapter 接口，运行时按环境注入具体实现。
 * - 开发/Web 环境：LocalStorageAdapter（浏览器真实落盘，刷新不丢）
 * - 生产 Tauri 环境：未来注入 SqliteAdapter（执行 schema.sql 的 DDL）
 *
 * 这样 Memory Lite 不再只是伪代码——壁垒（行为历史 + 用户画像）从 PPT 变资产。
 */

export interface UserProfileRecord {
  key: string;
  value: string;
  confidence: number;
  updatedAt: number;
}

export interface LifecycleEventRecord {
  id: number;
  eventType: string;
  payload?: string;
  importanceScore: number;
  timestamp: number;
}

export interface StorageAdapter {
  init(): void;
  insertLifecycleEvent(event: LifecycleEventRecord): void;
  getAllLifecycleEvents(): LifecycleEventRecord[];
  upsertUserProfile(rec: UserProfileRecord): void;
  getUserProfile(key: string): UserProfileRecord | null;
  getAllUserProfile(): UserProfileRecord[];
}

const PROFILE_KEY = "avataros:user_profile";
const EVENT_KEY = "avataros:lifecycle_event";

/**
 * LocalStorageAdapter — 浏览器环境真实持久化
 * 逻辑表结构严格对齐 schema.sql：user_profile + lifecycle_event
 */
export class LocalStorageAdapter implements StorageAdapter {
  private profiles: Map<string, UserProfileRecord> = new Map();
  private events: LifecycleEventRecord[] = [];
  private nextId = 1;

  public init(): void {
    try {
      const p = window.localStorage.getItem(PROFILE_KEY);
      if (p) {
        const arr = JSON.parse(p) as UserProfileRecord[];
        arr.forEach((r) => this.profiles.set(r.key, r));
      }
      const e = window.localStorage.getItem(EVENT_KEY);
      if (e) {
        this.events = JSON.parse(e) as LifecycleEventRecord[];
        this.nextId = this.events.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      }
    } catch (err) {
      console.warn("[LocalStorageAdapter] load failed, starting empty:", err);
    }
  }

  private persist() {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify([...this.profiles.values()]));
    window.localStorage.setItem(EVENT_KEY, JSON.stringify(this.events));
  }

  public insertLifecycleEvent(event: LifecycleEventRecord): void {
    const row: LifecycleEventRecord = { ...event, id: this.nextId++ };
    this.events.push(row);
    this.persist();
  }

  public getAllLifecycleEvents(): LifecycleEventRecord[] {
    return [...this.events];
  }

  public upsertUserProfile(rec: UserProfileRecord): void {
    this.profiles.set(rec.key, rec);
    this.persist();
  }

  public getUserProfile(key: string): UserProfileRecord | null {
    return this.profiles.get(key) ?? null;
  }

  public getAllUserProfile(): UserProfileRecord[] {
    return [...this.profiles.values()];
  }
}

export function createDefaultAdapter(): StorageAdapter {
  // 浏览器 / Tauri webview 环境
  if (typeof window !== "undefined" && window.localStorage) {
    return new LocalStorageAdapter();
  }
  // 非浏览器环境（如 SSR 测试）降级为内存桩
  return new MemoryOnlyAdapter();
}

/** 非浏览器环境的纯内存兜底（不持久化，仅保证类型完整） */
class MemoryOnlyAdapter implements StorageAdapter {
  private profiles = new Map<string, UserProfileRecord>();
  private events: LifecycleEventRecord[] = [];
  private nextId = 1;
  public init(): void {}
  public insertLifecycleEvent(event: LifecycleEventRecord): void {
    this.events.push({ ...event, id: this.nextId++ });
  }
  public getAllLifecycleEvents(): LifecycleEventRecord[] {
    return [...this.events];
  }
  public upsertUserProfile(rec: UserProfileRecord): void {
    this.profiles.set(rec.key, rec);
  }
  public getUserProfile(key: string): UserProfileRecord | null {
    return this.profiles.get(key) ?? null;
  }
  public getAllUserProfile(): UserProfileRecord[] {
    return [...this.profiles.values()];
  }
}
