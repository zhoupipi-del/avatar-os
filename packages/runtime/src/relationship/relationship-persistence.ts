// ============================================================
// Relationship Persistence (v0.3.7-A) — 防抖 / 串行写入协调器
// ============================================================
// 纯逻辑，零 Tauri / Node 依赖：只通过注入的 FileAccess 读写。
//   - 防抖保存（默认 8s）：多次变化只保存最新快照；
//   - 原子写入（临时文件 → rename）：异常退出不留下半截 JSON；
//   - 串行化写入队列：旧写入完成更晚也不能覆盖新状态；
//   - 加载校验 schemaVersion：不兼容 → 安全回退 neutral（不崩溃）。
// ============================================================

import {
  type PersistedRelationship,
  type FileAccess,
  type RelationshipRepository,
} from "./relationship-repository";
import {
  RelationshipState,
  RelationshipHistory,
  NEUTRAL_RELATIONSHIP,
  NEUTRAL_HISTORY,
  clampRelationship,
  RELATIONSHIP_SCHEMA_VERSION,
} from "./relationship-state";

const CURRENT_SCHEMA = RELATIONSHIP_SCHEMA_VERSION;

export class RelationshipPersistence implements RelationshipRepository {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: PersistedRelationship | null = null;
  private writing: Promise<void> | null = null;
  private readonly debounceMs: number;

  constructor(
    private readonly file: FileAccess,
    private readonly relPath: string,
    private readonly tmpPath: string,
    debounceMs = 8000,
  ) {
    this.debounceMs = debounceMs;
  }

  scheduleSave(value: PersistedRelationship): void {
    this.pending = value;
    if (this.saveTimer != null) return; // 已在防抖计时中
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.saveTimer != null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const snapshot = this.pending;
    this.pending = null;
    if (snapshot != null) {
      await this.writeAtomically(snapshot);
    }
    // 等待任何在途写入完成，确保退出前落盘
    if (this.writing != null) await this.writing;
  }

  async load(): Promise<PersistedRelationship | null> {
    try {
      const exists = await this.file.exists(this.relPath);
      if (!exists) return null;
      const text = await this.file.readText(this.relPath);
      const parsed = safeParse(text);
      if (parsed == null) return null; // 损坏 / 非法 JSON → 安全回退 neutral
      return migrateOrFallback(parsed);
    } catch {
      return null; // 任何异常都不崩溃，回退 neutral
    }
  }

  private async writeAtomically(value: PersistedRelationship): Promise<void> {
    // 串行化：排队在在途写入之后，旧写入完成更晚也不能覆盖新状态
    const task = (async () => {
      if (this.writing != null) await this.writing;
      const json = JSON.stringify(value);
      await this.file.writeText(this.tmpPath, json);
      await this.file.rename(this.tmpPath, this.relPath);
    })();
    this.writing = task;
    try {
      await task;
    } finally {
      if (this.writing === task) this.writing = null;
    }
  }
}

function safeParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 校验 + 夹紧 + 版本迁移 / 安全回退。任何异常都回退 neutral，绝不抛错。
 * 当前仅 v1；未来版本在此做迁移，不兼容一律回退 neutral。
 */
function migrateOrFallback(raw: any): PersistedRelationship | null {
  try {
    if (raw == null || typeof raw !== "object") return null;
    const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
    if (version !== CURRENT_SCHEMA) return null; // 不兼容 → 安全回退 neutral
    const state: RelationshipState = clampRelationship({ ...NEUTRAL_RELATIONSHIP, ...(raw.state ?? {}) });
    const history: RelationshipHistory = { ...NEUTRAL_HISTORY, ...(raw.history ?? {}) };
    return { state, history, schemaVersion: CURRENT_SCHEMA };
  } catch {
    return null;
  }
}
