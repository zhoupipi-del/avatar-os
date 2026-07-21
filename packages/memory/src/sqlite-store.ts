/**
 * Memory Lite — SQLite 持久层适配器
 *
 * 真实持久化：通过 StorageAdapter 抽象层落盘。
 * 当前环境注入 LocalStorageAdapter（浏览器真实写入 localStorage），
 * 逻辑表结构严格对齐 schema.sql（user_profile + lifecycle_event）。
 * 生产 Tauri 环境可注入 SqliteAdapter 执行 schema.sql 的 DDL。
 */

import { clamp01 } from "@avatar-os/primitives";
import {
  StorageAdapter,
  LocalStorageAdapter,
  createDefaultAdapter,
  UserProfileRecord,
  LifecycleEventRecord,
} from "./storage-adapter";

export interface UserProfile {
  key: string;
  value: string;
  confidence: number;
  updatedAt: number;
}

export interface LifecycleEvent {
  eventType: string; // e.g., 'WORK_LATE', 'CLICK_TOUCH', 'WORK_FATIGUE'
  payload?: string; // JSON 数据
  importanceScore: number; // 0.0 - 1.0，> 0.8 才进入长期回忆
  timestamp: number;
}

// 兼容旧接口别名
export type MemoryEvent = LifecycleEvent;

export class MemoryStore {
  private adapter: StorageAdapter;

  // SQLite 表结构 DDL — 与 schema.sql 同步（Tauri 生产环境执行）
  public readonly INIT_DDL = `
    CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lifecycle_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload TEXT,
      importance_score REAL DEFAULT 0.5,
      timestamp INTEGER NOT NULL
    );
  `;

  constructor(adapter?: StorageAdapter) {
    this.adapter = adapter ?? createDefaultAdapter();
  }

  public async init(): Promise<void> {
    this.adapter.init();
    const profileCount = this.adapter.getAllUserProfile().length;
    const eventCount = this.adapter.getAllLifecycleEvents().length;
    console.log(
      `[MemoryStore] initialized. profiles=${profileCount}, events=${eventCount}. ` +
        `DDL (Tauri prod): user_profile + lifecycle_event`,
    );
  }

  /** 写入一条行为/生命周期事件到本地持久层 */
  public remember(event: LifecycleEvent): void {
    const row: LifecycleEventRecord = {
      id: 0,
      eventType: event.eventType,
      payload: event.payload,
      importanceScore: event.importanceScore,
      timestamp: event.timestamp,
    };
    this.adapter.insertLifecycleEvent(row);
    console.log(
      `[MemoryStore INSERT] lifecycle_event: type=${event.eventType}, ` +
        `importance=${event.importanceScore.toFixed(2)}`,
    );
  }

  /** 读取用户画像（长期记忆） */
  public recall(key: string): UserProfile | null {
    const rec = this.adapter.getUserProfile(key);
    if (!rec) return null;
    return { key: rec.key, value: rec.value, confidence: rec.confidence, updatedAt: rec.updatedAt };
  }

  /** 直接写入用户画像键值 */
  public rememberProfile(key: string, value: string, confidence = 1.0): void {
    const rec: UserProfileRecord = { key, value, confidence, updatedAt: Date.now() };
    this.adapter.upsertUserProfile(rec);
    console.log(`[MemoryStore UPSERT] user_profile: ${key}=${value}`);
  }

  public dumpEvents(): LifecycleEventRecord[] {
    return this.adapter.getAllLifecycleEvents();
  }

  /**
   * O6 记忆生产者：返回"记忆甜度" 0.0~1.0。
   * 依据最近一次交互事件距今的时间衰减——刚互动过 → 接近 1，
   * 长时间无人理睬 → 趋近 0。该值喂给 DriveEngine 的孤独压力乘性衰减，
   * 实现"最近的陪伴能缓解孤独"的壁垒行为。
   */
  public getRecentInteractionBonus(): number {
    const events = this.adapter.getAllLifecycleEvents();
    if (events.length === 0) return 0;
    const lastTs = events.reduce((m, e) => Math.max(m, e.timestamp), 0);
    const hoursAgo = (Date.now() - lastTs) / 3_600_000;
    // 指数快速衰减模型 (tau = 0.3h ≈ 18min)：
    //   刚互动完 bonus≈0.9（记忆抚慰，孤独压到 ~0.19，不打扰用户）；
    //   离场 30min bonus≈0.19 → 孤独压强≈0.69 > 0.65，精准触发 PEEK 想念探头。
    // 替换原 12h 线性衰减（一次互动后 12h 内都把孤独压在阈值下，演示 100% 哑火）。
    return clamp01(Math.exp(-hoursAgo / 0.3));
  }

  // 兼容旧接口（App.tsx 调用 logInteraction）
  public async logInteraction(event: string): Promise<void> {
    this.remember({
      eventType: event,
      importanceScore: 0.5,
      timestamp: Date.now(),
    });
  }
}

export const memoryStore = new MemoryStore();
