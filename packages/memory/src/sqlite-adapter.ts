/**
 * SQLiteStorageAdapter — Tauri 生产环境真实持久化
 *
 * 通过 tauri-plugin-sql 把 user_profile + lifecycle_event 落盘到 SQLite。
 * 仅在 Tauri webview（window.__TAURI_INTERNALS__ 存在）下被 createDefaultAdapter 选用；
 * 非 Tauri 环境构造或调用会安全失败（不抛崩，仅告警），由上层降级处理。
 *
 * 2026-07-21：实现 StorageAdapter 的异步接口（Database.load / execute / select 均为异步）。
 */

import Database from "@tauri-apps/plugin-sql";
import {
  StorageAdapter,
  UserProfileRecord,
  LifecycleEventRecord,
} from "./storage-adapter";

const DB_PATH = "sqlite:avatar_memory.db";

export class SQLiteStorageAdapter implements StorageAdapter {
  private db: Database | null = null;

  public async init(): Promise<void> {
    if (this.db) return;
    try {
      this.db = await Database.load(DB_PATH);
      await this.db.execute(
        `CREATE TABLE IF NOT EXISTS user_profile (
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
         );`,
      );
      console.log("[SQLiteStorageAdapter 🗄️] SQLite database linked and schema ensured.");
    } catch (err) {
      console.warn("[SQLiteStorageAdapter ⚠️] init failed, falling back to no-op:", err);
      this.db = null;
    }
  }

  private ensure(): Database {
    if (!this.db) {
      throw new Error("[SQLiteStorageAdapter] not initialized (call init() first)");
    }
    return this.db;
  }

  public async insertLifecycleEvent(event: LifecycleEventRecord): Promise<void> {
    const db = this.ensure();
    await db.execute(
      "INSERT INTO lifecycle_event (event_type, payload, importance_score, timestamp) VALUES ($1, $2, $3, $4)",
      [event.eventType, event.payload ?? null, event.importanceScore, event.timestamp],
    );
  }

  public async getAllLifecycleEvents(): Promise<LifecycleEventRecord[]> {
    const db = this.ensure();
    const rows = await db.select<LifecycleEventRecord[]>(
      `SELECT id, event_type AS eventType, payload, importance_score AS importanceScore, timestamp
         FROM lifecycle_event ORDER BY timestamp DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      payload: r.payload ?? undefined,
      importanceScore: r.importanceScore,
      timestamp: r.timestamp,
    }));
  }

  public async upsertUserProfile(rec: UserProfileRecord): Promise<void> {
    const db = this.ensure();
    await db.execute(
      `INSERT INTO user_profile (key, value, confidence, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(key) DO UPDATE SET
           value=excluded.value,
           confidence=excluded.confidence,
           updated_at=excluded.updated_at`,
      [rec.key, rec.value, rec.confidence, rec.updatedAt],
    );
  }

  public async getUserProfile(key: string): Promise<UserProfileRecord | null> {
    const db = this.ensure();
    const rows = await db.select<UserProfileRecord[]>(
      "SELECT key, value, confidence, updated_at AS updatedAt FROM user_profile WHERE key=$1",
      [key],
    );
    return rows[0] ?? null;
  }

  public async getAllUserProfile(): Promise<UserProfileRecord[]> {
    const db = this.ensure();
    return await db.select<UserProfileRecord[]>(
      "SELECT key, value, confidence, updated_at AS updatedAt FROM user_profile",
    );
  }
}
