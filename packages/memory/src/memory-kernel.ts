// ============================================================
// MemoryKernel — 三表持久层 (v0.1.0-alpha Kernel Skeleton)
// ============================================================
// 设计原则（对齐 BOSS 战略壁垒 #2）：
//   - user_profile:    用户画像键值对（如 user_name、work_style）
//   - interaction_log: append-only 交互历史（每次物理/社交事件落盘）
//   - emotion_memory:  情绪记忆（带 PAD 三轴快照的情感标定事件）
//
// MemoryKernel 是 AvatarKernel 的聚合子模块，不依赖全局单例。
// 构造函数接收 StorageAdapter，保证不同环境可注入不同适配器。
// ============================================================

import type { EmotionalState } from "@avatar-os/primitives";
import {
  StorageAdapter,
  createDefaultAdapter,
  UserProfileRecord,
  LifecycleEventRecord,
} from "./storage-adapter";

// ------- 数据接口 -------

export interface MemoryUserProfile {
  key: string;
  value: string;
  confidence: number;
  updatedAt: number;
}

export interface InteractionLog {
  id: number;
  eventType: string;
  payload?: string;
  importanceScore: number;
  timestamp: number;
}

export interface EmotionMemory {
  id: number;
  trigger: string;           // 触发事件类型
  valence: number;           // PAD 愉悦度 (-1~1)
  arousal: number;           // PAD 唤醒度 (0~1)
  stability: number;         // PAD 稳定度 (0~1)
  /** 情绪快照的完整 PAD 状态，JSON 序列化存储 */
  padSnapshot?: string;
  importanceScore: number;
  timestamp: number;
}

// ------- MemoryKernel -------

export class MemoryKernel {
  public static readonly SCHEMA_DDL = `
    CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interaction_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload TEXT,
      importance_score REAL DEFAULT 0.5,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS emotion_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT NOT NULL,
      valence REAL DEFAULT 0.0,
      arousal REAL DEFAULT 0.3,
      stability REAL DEFAULT 1.0,
      pad_snapshot TEXT,
      importance_score REAL DEFAULT 0.5,
      timestamp INTEGER NOT NULL
    );

    -- 索引：按时间降序查最近交互 / 情绪
    CREATE INDEX IF NOT EXISTS idx_interaction_ts
      ON interaction_log(timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_emotion_ts
      ON emotion_memory(timestamp DESC);
  `;

  private adapter: StorageAdapter;

  constructor(adapter?: StorageAdapter) {
    this.adapter = adapter ?? createDefaultAdapter();
  }

  public async init(): Promise<void> {
    await this.adapter.init();
    const profileCount = (await this.adapter.getAllUserProfile()).length;
    console.log(
      `[MemoryKernel] initialized. profiles=${profileCount}, ` +
        `DDL: user_profile + interaction_log + emotion_memory`,
    );
  }

  // ------- User Profile -------

  public async saveProfile(key: string, value: string, confidence = 1.0): Promise<void> {
    const rec: UserProfileRecord = { key, value, confidence, updatedAt: Date.now() };
    await this.adapter.upsertUserProfile(rec);
  }

  public async getProfile(key: string): Promise<MemoryUserProfile | null> {
    const rec = await this.adapter.getUserProfile(key);
    if (!rec) return null;
    return { key: rec.key, value: rec.value, confidence: rec.confidence, updatedAt: rec.updatedAt };
  }

  // ------- Interaction Log -------

  public async recordInteraction(event: {
    eventType: string;
    payload?: string;
    importanceScore?: number;
  }): Promise<void> {
    const row: LifecycleEventRecord = {
      id: 0,
      eventType: event.eventType,
      payload: event.payload,
      importanceScore: event.importanceScore ?? 0.5,
      timestamp: Date.now(),
    };
    await this.adapter.insertLifecycleEvent(row);
  }

  // ------- Emotion Memory -------

  /**
   * recordEmotion — 当 AvatarKernel 状态迁移时截图 PAD 三轴，
   * 作为情绪快照写入 emotion_memory（通过 user_profile 元表模拟）。
   * 生产 Tauri sqlite 环境下由 schema.sql 创建真实 emotion_memory 表。
   */
  public async recordEmotion(trigger: string, emotionalState: EmotionalState, importanceScore = 0.5): Promise<void> {
    const snapshot: EmotionMemory = {
      id: 0,
      trigger,
      valence: emotionalState.valence,
      arousal: emotionalState.arousal,
      stability: emotionalState.stability,
      padSnapshot: JSON.stringify(emotionalState),
      importanceScore,
      timestamp: Date.now(),
    };
    // 当前适配器仅支持 user_profile + lifecycle_event 两表，
    // emotion 数据以特殊 key 前缀存入 user_profile（临时降级方案）。
    const key = `emotion:${Date.now()}`;
    await this.adapter.upsertUserProfile({
      key,
      value: JSON.stringify(snapshot),
      confidence: importanceScore,
      updatedAt: Date.now(),
    });
  }

  // ------- 查询 -------

  public getDdl(): string {
    return MemoryKernel.SCHEMA_DDL;
  }
}
