/**
 * Storage Adapter — 真实本地持久化抽象层
 *
 * 设计：MemoryStore 依赖 StorageAdapter 接口，运行时按环境注入具体实现。
 * - 开发/Web 环境：LocalStorageAdapter（浏览器真实落盘，刷新不丢）
 * - 生产 Tauri 环境：SQLiteStorageAdapter（经 tauri-plugin-sql 落盘 SQLite）
 * - 非浏览器（node 测试）：MemoryOnlyAdapter（纯内存兜底，保证类型完整）
 *
 * 2026-07-21 演进：接口方法统一改为 async，以支撑 Tauri SQLite 的异步 I/O。
 * 调用方（MemoryStore / MemoryKernel）相应 await。
 */

import { SQLiteStorageAdapter } from "./sqlite-adapter";

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
  init(): Promise<void>;
  insertLifecycleEvent(event: LifecycleEventRecord): Promise<void>;
  getAllLifecycleEvents(): Promise<LifecycleEventRecord[]>;
  upsertUserProfile(rec: UserProfileRecord): Promise<void>;
  getUserProfile(key: string): Promise<UserProfileRecord | null>;
  getAllUserProfile(): Promise<UserProfileRecord[]>;
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

  public async init(): Promise<void> {
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

  public async insertLifecycleEvent(event: LifecycleEventRecord): Promise<void> {
    const row: LifecycleEventRecord = { ...event, id: this.nextId++ };
    this.events.push(row);
    this.persist();
  }

  public async getAllLifecycleEvents(): Promise<LifecycleEventRecord[]> {
    return [...this.events];
  }

  public async upsertUserProfile(rec: UserProfileRecord): Promise<void> {
    this.profiles.set(rec.key, rec);
    this.persist();
  }

  public async getUserProfile(key: string): Promise<UserProfileRecord | null> {
    return this.profiles.get(key) ?? null;
  }

  public async getAllUserProfile(): Promise<UserProfileRecord[]> {
    return [...this.profiles.values()];
  }
}

export function createDefaultAdapter(): StorageAdapter {
  // 生产 Tauri webview 环境：优先使用真实 SQLite 持久化
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return new SQLiteStorageAdapter();
  }
  // 浏览器 / Web 环境
  if (typeof window !== "undefined" && window.localStorage) {
    return new LocalStorageAdapter();
  }
  // 非浏览器环境（如 node 测试）降级为内存桩
  return new MemoryOnlyAdapter();
}

/** 非浏览器环境的纯内存兜底（不持久化，仅保证类型完整） */
class MemoryOnlyAdapter implements StorageAdapter {
  private profiles = new Map<string, UserProfileRecord>();
  private events: LifecycleEventRecord[] = [];
  private nextId = 1;
  public async init(): Promise<void> {}
  public async insertLifecycleEvent(event: LifecycleEventRecord): Promise<void> {
    this.events.push({ ...event, id: this.nextId++ });
  }
  public async getAllLifecycleEvents(): Promise<LifecycleEventRecord[]> {
    return [...this.events];
  }
  public async upsertUserProfile(rec: UserProfileRecord): Promise<void> {
    this.profiles.set(rec.key, rec);
  }
  public async getUserProfile(key: string): Promise<UserProfileRecord | null> {
    return this.profiles.get(key) ?? null;
  }
  public async getAllUserProfile(): Promise<UserProfileRecord[]> {
    return [...this.profiles.values()];
  }
}
