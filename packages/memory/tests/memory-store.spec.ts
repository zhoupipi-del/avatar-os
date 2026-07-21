import { describe, expect, test } from "vitest";
import { MemoryStore } from "../src/sqlite-store";
import { createDefaultAdapter } from "../src/storage-adapter";

/**
 * 锁定 StorageAdapter 异步化后的 MemoryStore 契约。
 * node 环境下 createDefaultAdapter 返回 MemoryOnlyAdapter（纯内存），
 * 与 Tauri 下 SQLiteStorageAdapter 共享同一套 async 接口，行为一致。
 */
describe("MemoryStore async contract (node fallback)", () => {
  test("init → remember → bonus → recall → dumpEvents 全链路 async 可跑", async () => {
    const store = new MemoryStore();
    await store.init();

    // 初始无交互 → bonus 为 0
    expect(store.getRecentInteractionBonus()).toBe(0);

    await store.remember({
      eventType: "CLICK_TOUCH",
      importanceScore: 0.8,
      timestamp: Date.now(),
    });

    // 刚互动完 → bonus 应立即 > 0（同步热路径，不依赖异步读）
    expect(store.getRecentInteractionBonus()).toBeGreaterThan(0);

    await store.rememberProfile("user_name", "BOSS", 1.0);
    const rec = await store.recall("user_name");
    expect(rec?.value).toBe("BOSS");

    const events = await store.dumpEvents();
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("CLICK_TOUCH");
  });

  test("createDefaultAdapter 在 node 下返回可用适配器（内存兜底）", () => {
    const a = createDefaultAdapter();
    expect(a).toBeDefined();
    expect(typeof a.init).toBe("function");
    expect(typeof a.insertLifecycleEvent).toBe("function");
  });
});
