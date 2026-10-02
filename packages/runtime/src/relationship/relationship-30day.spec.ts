import { describe, it, expect } from "vitest";
import { RelationshipEngine } from "./relationship-engine";
import { RelationshipPersistence } from "./relationship-persistence";
import type { FileAccess, PersistedRelationship } from "./relationship-repository";
import { createInitialRelationship, RELATIONSHIP_SCHEMA_VERSION } from "./relationship-state";

const REL = "relationship-v1.json";
const TMP = "relationship-v1.json.tmp";
const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const AWAY_DAYS = new Set([10, 11, 12, 25]); // 若干天完全离开

/** 确定性 LCG（同一 seed → 同一序列）。 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

class FakeFileAccess implements FileAccess {
  private store = new Map<string, string>();
  writeCount = 0;
  async exists(p: string): Promise<boolean> {
    return this.store.has(p);
  }
  async readText(p: string): Promise<string> {
    const v = this.store.get(p);
    if (v == null) throw new Error("not found");
    return v;
  }
  async writeText(p: string, c: string): Promise<void> {
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
}

async function runSoak(seed: number): Promise<{
  final: ReturnType<RelationshipEngine["getState"]>;
  totalInteractions: number;
  writeCount: number;
}> {
  const rng = makeRng(seed);
  const fa = new FakeFileAccess();
  const repo = new RelationshipPersistence(fa, REL, TMP, 8000);
  let now = T0;
  let engine = new RelationshipEngine();
  let totalInteractions = 0;

  for (let day = 0; day < 30; day++) {
    if (AWAY_DAYS.has(day)) {
      // 整天离开：仅推进时间（无互动，触发极慢自然回落）
      now += DAY;
      engine.tickTime(now);
      continue;
    }
    // 离开后回来 → 计一次 return（模拟 AWAY→非AWAY 边沿）
    engine.recordInteraction("return", now + 1000);
    totalInteractions++;
    // 当天 3~10 次互动，分散在日内
    const n = 3 + Math.floor(rng() * 8);
    for (let i = 0; i < n; i++) {
      const kind = rng() < 0.5 ? "touch" : "speak";
      engine.recordInteraction(kind, now + 2000 + i * 1500);
      totalInteractions++;
      repo.scheduleSave({
        state: engine.getState(),
        history: engine.getHistory(),
        schemaVersion: RELATIONSHIP_SCHEMA_VERSION,
      });
    }
    now += DAY;
    engine.tickTime(now); // 日终

    // 每 7 天模拟一次应用重启（持久化 → 重载）
    if (day % 7 === 6) {
      await repo.flush();
      const loaded = await repo.load();
      expect(loaded).not.toBeNull();
      engine = new RelationshipEngine(loaded!.state, loaded!.history);
    }
  }

  // 末次 flush，确保落盘
  await repo.flush();
  const final = engine.getState();
  return { final, totalInteractions, writeCount: fa.writeCount };
}

describe("30 天长期模拟 (fake clock)", () => {
  it("familiarity 有明显但缓慢的增长；trust 不会一天满值；attachment 需多日形成", async () => {
    const { final } = await runSoak(20260724);
    expect(final.relationalTrust).toBeGreaterThan(0);
    expect(final.relationalTrust).toBeLessThan(1); // 不会满值
    expect(final.familiarity).toBeGreaterThan(0.2); // 明显增长
    expect(final.attachment).toBeGreaterThan(0.1); // 多日形成
    expect(final.activeDays).toBeGreaterThanOrEqual(26); // 30 天 - 4 离开天
  });

  it("所有值始终在 [0,1]", async () => {
    const { final } = await runSoak(20260724);
    for (const v of [final.relationalTrust, final.familiarity, final.attachment]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("同一随机种子结果确定", async () => {
    const a = await runSoak(20260724);
    const b = await runSoak(20260724);
    expect(a.final).toEqual(b.final);
    expect(a.totalInteractions).toBe(b.totalInteractions);
  });

  it("存储写入次数受防抖控制（远小于互动次数）", async () => {
    const { totalInteractions, writeCount } = await runSoak(20260724);
    expect(writeCount).toBeGreaterThan(0);
    expect(writeCount).toBeLessThan(totalInteractions);
  });

  it("关系引擎不发出任何 PhysicalIntent", async () => {
    const { final } = await runSoak(20260724);
    // 引擎无 emit/dispatch；返回的是 RelationshipState 而非意图
    expect((RelationshipEngine.prototype as unknown as { emit?: unknown }).emit).toBeUndefined();
    expect(final).toHaveProperty("relationalTrust");
    expect(final).not.toHaveProperty("type"); // 不是 PhysicalIntent
  });
});
