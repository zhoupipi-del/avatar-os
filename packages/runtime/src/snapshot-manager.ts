import { LifeState, MoodState } from "@avatar-os/primitives";
import { driveEngine } from "./drive-engine";
import { avatarFSM } from "./avatar-fsm";

export interface KernelSnapshot {
  version: string;
  timestamp: number;
  mood: MoodState;
  lifeState: LifeState;
}

const SNAPSHOT_VERSION = "0.2.0";

/**
 * SnapshotManager — 内核状态快照与恢复。
 * 仅依赖真实已存在的 API：driveEngine.getState() / avatarFSM.getMood()，
 * 以及本文件为两者增量补上的 restoreState()。
 * 用途：崩溃自愈 / 跨会话续命 / 测试可重放。
 */
export class SnapshotManager {
  public static exportSnapshot(): KernelSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      timestamp: Date.now(),
      mood: avatarFSM.getMood(),
      lifeState: driveEngine.getState(),
    };
  }

  public static restoreSnapshot(snapshot: KernelSnapshot): void {
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(`[Snapshot ❌] Incompatible snapshot version: ${snapshot.version}`);
    }
    avatarFSM.restoreState(snapshot.mood);
    driveEngine.restoreState(snapshot.lifeState);
    console.log("[Snapshot 🟢] Kernel state restored from snapshot.");
  }
}
