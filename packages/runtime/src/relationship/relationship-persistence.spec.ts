import { describe, it, expect, vi, afterEach } from "vitest";
import { RelationshipPersistence } from "./relationship-persistence";
import type { FileAccess, PersistedRelationship } from "./relationship-repository";
import { createInitialRelationship, RELATIONSHIP_SCHEMA_VERSION } from "./relationship-state";

const REL = "relationship-v1.json";
const TMP = "relationship-v1.json.tmp";

function makePersisted(trust: number, familiarity: number): PersistedRelationship {
  return {
    state: createInitialRelationship({ relationalTrust: trust, familiarity, lastInteractionAt: 123 }),
    history: {
      conversationCount: 1,
      touchCount: 1,
      returnCount: 0,
      meaningfulInteractionCount: 2,
      lastActiveDay: "2026-7-1",
      sessionCount: 1,
    },
    schemaVersion: RELATIONSHIP_SCHEMA_VERSION,
  };
}

/** 内存文件访问：支持模拟读取失败、慢写入、以及可控延迟写入（竞态测试）。 */
class FakeFileAccess implements FileAccess {
  private store = new Map<string, string>();
  writeCount = 0;
  constructor(private opts: { failRead?: boolean; slowWriteMs?: number } = {}) {}
  async exists(p: string): Promise<boolean> {
    return this.store.has(p);
  }
  async readText(p: string): Promise<string> {
    if (this.opts.failRead) throw new Error("forced read failure");
    const v = this.store.get(p);
    if (v == null) throw new Error("not found");
    return v;
  }
  async writeText(p: string, c: string): Promise<void> {
    if (this.opts.slowWriteMs) {
      await new Promise((r) => setTimeout(r, this.opts.slowWriteMs));
    }
    this.store.set(p, c);
    this.writeCount++;
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.store.get(from);
    if (v != null) {
      this.store.set(to, v);
      this.store.delete(from);
    }
  }
  get(p: string): string | undefined {
    return this.store.get(p);
  }
  has(p: string): boolean {
    return this.store.has(p);
  }
}

/** 延迟写入：writeText 推入待决队列，手动 resolve 以模拟"旧写入完成更晚"。 */
class DeferredFileAccess implements FileAccess {
  private store = new Map<string, string>();
  pendingWrites: Array<{ resolve: () => void }> = [];
  async exists(p: string): Promise<boolean> {
    return this.store.has(p);
  }
  async readText(p: string): Promise<string> {
    const v = this.store.get(p);
    if (v == null) throw new Error("not found");
    return v;
  }
  async writeText(p: string, c: string): Promise<void> {
    await new Promise<void>((resolve) => this.pendingWrites.push({ resolve }));
    this.store.set(p, c);
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.store.get(from);
    if (v != null) {
      this.store.set(to, v);
      this.store.delete(from);
    }
  }
  resolveNext(): void {
    const w = this.pendingWrites.shift();
    w?.resolve();
  }
  get(p: string): string | undefined {
    return this.store.get(p);
  }
}

/** 让微任务队列充分排空，使串行写入链推进到下一次 writeText 入队。 */
async function flushMicrotasks(turns = 50): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("持久化加载 / 保存 (#11-#15)", () => {
  it("保存后重新加载状态一致 (#11)", async () => {
    const fa = new FakeFileAccess();
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    const data = makePersisted(0.4, 0.3);
    p.scheduleSave(data);
    await p.flush();
    expect(fa.has(REL)).toBe(true);
    const loaded = await p.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.relationalTrust).toBeCloseTo(0.4, 6);
    expect(loaded!.state.familiarity).toBeCloseTo(0.3, 6);
    expect(loaded!.state.schemaVersion).toBe(RELATIONSHIP_SCHEMA_VERSION);
  });

  it("缺失文件回退到 neutral（load 返回 null）(#12)", async () => {
    const fa = new FakeFileAccess();
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    const loaded = await p.load();
    expect(loaded).toBeNull();
  });

  it("非法 JSON / 损坏数据不崩溃，安全回退 (#13)", async () => {
    const fa = new FakeFileAccess();
    fa.writeText; // noop reference
    // 直接塞入损坏内容
    (fa as unknown as { store: Map<string, string> }).store.set(REL, "{not valid json");
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    let threw = false;
    let loaded: PersistedRelationship | null = null;
    try {
      loaded = await p.load();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false); // 不崩溃
    expect(loaded).toBeNull(); // 安全回退 neutral
  });

  it("读取抛出异常也不崩溃，回退 neutral (#13)", async () => {
    const fa = new FakeFileAccess({ failRead: true });
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    const loaded = await p.load();
    expect(loaded).toBeNull();
  });

  it("超范围数据加载后被夹紧 (#14)", async () => {
    const fa = new FakeFileAccess();
    const bad = {
      state: { relationalTrust: 5, familiarity: -2, attachment: 9, schemaVersion: 1 },
      history: {},
      schemaVersion: 1,
    };
    (fa as unknown as { store: Map<string, string> }).store.set(REL, JSON.stringify(bad));
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    const loaded = await p.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.state.relationalTrust).toBe(1);
    expect(loaded!.state.familiarity).toBe(0);
    expect(loaded!.state.attachment).toBe(1);
  });

  it("schemaVersion 不兼容时执行安全迁移/回退 (#15)", async () => {
    const fa = new FakeFileAccess();
    const future = { state: {}, history: {}, schemaVersion: 999 };
    (fa as unknown as { store: Map<string, string> }).store.set(REL, JSON.stringify(future));
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    const loaded = await p.load();
    expect(loaded).toBeNull(); // 不兼容 → 安全回退 neutral
  });
});

describe("防抖与刷新 (#16-#17 + 必补边界)", () => {
  it("防抖期间多次变化，最终只保存最新快照，且只写一次 (#16, 边界)", async () => {
    vi.useFakeTimers();
    const fa = new FakeFileAccess();
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    p.scheduleSave(makePersisted(0.1, 0.1));
    p.scheduleSave(makePersisted(0.2, 0.2));
    p.scheduleSave(makePersisted(0.3, 0.3)); // 最新
    // 计时器未到，不应写入
    expect(fa.writeCount).toBe(0);
    await vi.advanceTimersByTimeAsync(8000);
    await vi.advanceTimersByTimeAsync(50);
    expect(fa.writeCount).toBe(1); // 只写一次
    const loaded = JSON.parse(fa.get(REL)!);
    expect(loaded.state.relationalTrust).toBeCloseTo(0.3, 6); // 最新快照
  });

  it("退出刷新不会丢最后一次有效互动 (#17)", async () => {
    vi.useFakeTimers();
    const fa = new FakeFileAccess();
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    p.scheduleSave(makePersisted(0.1, 0.1));
    p.scheduleSave(makePersisted(0.9, 0.9)); // 最后一次，计时器尚未触发
    expect(fa.writeCount).toBe(0);
    await p.flush(); // 显式刷新
    expect(fa.writeCount).toBe(1);
    const loaded = JSON.parse(fa.get(REL)!);
    expect(loaded.state.relationalTrust).toBeCloseTo(0.9, 6);
  });

  it("flush 等待正在进行的写入并保存最后一次状态 (#17, 边界)", async () => {
    const fa = new FakeFileAccess({ slowWriteMs: 30 });
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    p.scheduleSave(makePersisted(0.1, 0.1));
    const flushPromise = p.flush(); // 启动慢写入
    p.scheduleSave(makePersisted(0.7, 0.7)); // 写入进行中再次变更
    await flushPromise;
    // flush 只等第一波；pending 已在 flush 后置空前捕获，但 scheduleSave 又排了一次 → 再 flush
    await p.flush();
    const loaded = JSON.parse(fa.get(REL)!);
    expect(loaded.state.relationalTrust).toBeCloseTo(0.7, 6);
  });

  it("旧写入完成得更晚时不能覆盖新状态（串行化写入队列）(#边界)", async () => {
    const fa = new DeferredFileAccess();
    const p = new RelationshipPersistence(fa, REL, TMP, 8000);
    p.scheduleSave(makePersisted(0.1, 0.1)); // v1
    const f1 = p.flush(); // 开始写入 v1（延迟）
    p.scheduleSave(makePersisted(0.8, 0.8)); // v2 更新
    const f2 = p.flush(); // 排队写入 v2（在 v1 之后）
    // v1 先解析、rename；task1 完成后 task2 才会把自己的 writeText 入队，
    // 因此必须先排空微任务，等 task2 入队后再 resolve 第二次，否则第二次 resolveNext 是空操作。
    fa.resolveNext(); // 完成 v1 的 writeText
    await flushMicrotasks(); // task1 完成 rename + task2 入队它的 writeText
    fa.resolveNext(); // 完成 v2 的 writeText
    await Promise.all([f1, f2]);
    const loaded = JSON.parse(fa.get(REL)!);
    expect(loaded.state.relationalTrust).toBeCloseTo(0.8, 6); // 新状态胜出
  });
});
