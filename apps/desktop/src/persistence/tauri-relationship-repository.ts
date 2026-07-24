// ============================================================
// Tauri Relationship Repository (v0.3.7-A) — 桌面持久化适配
// ============================================================
// 这是整个项目**唯一**允许 import Tauri / plugin-fs 的地方。
// Runtime 的 RelationshipPersistence（纯逻辑）通过注入的 TauriFileAccess 读写，
// 从而保持 runtime 零 Tauri 依赖、Node 测试纯净。
//
// 单一真相源：应用本地数据目录（BaseDirectory.AppLocalData）根部的 versioned JSON 文件。
// 写入采用临时文件替换（write tmp → rename），避免异常退出留下半截 JSON。
// ============================================================

import {
  BaseDirectory,
  exists,
  readTextFile,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  RelationshipPersistence,
  type FileAccess,
  type RelationshipRepository,
  type PersistedRelationship,
} from "@avatar-os/runtime";

const RELATIONSHIP_FILE = "relationship-v1.json";
const TEMP_FILE = "relationship-v1.json.tmp";
const BASE_DIR = BaseDirectory.AppLocalData;

/** 基于 @tauri-apps/plugin-fs 的文件访问实现（唯一 Tauri 依赖点）。 */
class TauriFileAccess implements FileAccess {
  async exists(path: string): Promise<boolean> {
    return exists(path, { baseDir: BASE_DIR });
  }
  async readText(path: string): Promise<string> {
    return readTextFile(path, { baseDir: BASE_DIR });
  }
  async writeText(path: string, content: string): Promise<void> {
    await writeTextFile(path, content, { baseDir: BASE_DIR });
  }
  async rename(from: string, to: string): Promise<void> {
    await rename(from, to, { oldPathBaseDir: BASE_DIR, newPathBaseDir: BASE_DIR });
  }
}

/** 创建关系仓储（防抖默认 8s）。 */
export function createTauriRelationshipRepository(debounceMs = 8000): RelationshipRepository {
  return new RelationshipPersistence(new TauriFileAccess(), RELATIONSHIP_FILE, TEMP_FILE, debounceMs);
}

/**
 * 绑定窗口关闭请求：先尽力 flush 关系持久化，再 destroy 强制关闭。
 * 仅依赖 onCloseRequested（防 beforeunload 不可靠）。beforeunload 仍作 best-effort 兜底。
 */
export function attachRelationshipCloseHandler(repository: RelationshipRepository): void {
  const appWindow = getCurrentWindow();
  void appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await repository.flush();
    } finally {
      await appWindow.destroy();
    }
  });
}

export type { PersistedRelationship };
