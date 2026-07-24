import { describe, it, expect } from "vitest";
import {
  RelationshipEngine,
  isReturnEdge,
  type RelationshipFocusState,
} from "./relationship-engine";
import {
  NEUTRAL_RELATIONSHIP,
  createInitialRelationship,
  deriveEmotionBaseline,
  RELATIONSHIP_SCHEMA_VERSION,
} from "./relationship-state";

const T0 = 1_700_000_000_000; // 固定起点，便于推理

describe("关系数据模型与夹紧 (#1)", () => {
  it("中性关系的连续值全为 0，schemaVersion=1", () => {
    const s = NEUTRAL_RELATIONSHIP;
    expect(s.relationalTrust).toBe(0);
    expect(s.familiarity).toBe(0);
    expect(s.attachment).toBe(0);
    expect(s.schemaVersion).toBe(1);
  });

  it("createInitialRelationship 把超范围连续值夹紧到 [0,1] (#1, #14)", () => {
    const s = createInitialRelationship({ relationalTrust: 1.5, familiarity: -0.3, attachment: 2 });
    expect(s.relationalTrust).toBe(1);
    expect(s.familiarity).toBe(0);
    expect(s.attachment).toBe(1);
    expect(s.schemaVersion).toBe(RELATIONSHIP_SCHEMA_VERSION);
  });

  it("关系引擎不持有任何 emit / 发意图方法 (#10)", () => {
    const e = new RelationshipEngine();
    expect((e as unknown as { emit?: unknown }).emit).toBeUndefined();
    expect((e as unknown as { dispatch?: unknown }).dispatch).toBeUndefined();
  });
});

describe("中性关系对现有情绪/行为恒等 (#2)", () => {
  it("deriveEmotionBaseline(NEUTRAL) === NEUTRAL_EMOTION", () => {
    const base = deriveEmotionBaseline(NEUTRAL_RELATIONSHIP);
    expect(base.trust).toBeCloseTo(0.5, 6);
    expect(base.comfort).toBeCloseTo(0.5, 6);
    expect(base.loneliness).toBeCloseTo(0.5, 6);
    expect(base.curiosity).toBeCloseTo(0.5, 6);
  });

  it("高关系使 trust/comfort 基线略高于中性，但不越过 1", () => {
    const base = deriveEmotionBaseline(
      createInitialRelationship({ relationalTrust: 1, familiarity: 1 }),
    );
    expect(base.trust).toBeGreaterThan(0.5);
    expect(base.comfort).toBeGreaterThan(0.5);
    expect(base.trust).toBeLessThanOrEqual(1);
    expect(base.comfort).toBeLessThanOrEqual(1);
  });
});

describe("单次互动只产生极小增量 (#3)", () => {
  it("一次 touch 后 familiarity/trust 极小且不为零", () => {
    const e = new RelationshipEngine();
    const { state } = e.recordInteraction("touch", T0);
    expect(state.familiarity).toBeGreaterThan(0);
    expect(state.familiarity).toBeLessThan(0.1);
    expect(state.relationalTrust).toBeGreaterThan(0);
    expect(state.relationalTrust).toBeLessThan(0.1);
  });

  it("一次 speak 后变化同样极小", () => {
    const e = new RelationshipEngine();
    const { state } = e.recordInteraction("speak", T0);
    expect(state.familiarity).toBeGreaterThan(0);
    expect(state.familiarity).toBeLessThan(0.1);
  });
});

describe("同一事件重复提交不重复累计 (#4)", () => {
  it("同一 ms 的两次相同互动，第二次被去重", () => {
    const e = new RelationshipEngine();
    const r1 = e.recordInteraction("touch", T0);
    const r2 = e.recordInteraction("touch", T0);
    expect(r1.changed).toBe(true);
    expect(r2.changed).toBe(false); // 去重：同一事件/广播回声
    expect(r2.state.interactionCount).toBe(1);
  });
});

describe("高频点击存在收益递减 (#5)", () => {
  it("同一天内多次 touch，累计 familiarity 明显小于 base*freq", () => {
    const e = new RelationshipEngine();
    const BASE = 0.02;
    const N = 10;
    for (let i = 0; i < N; i++) {
      // 每次间隔 >1s 避免去重，但仍在同日 → 收益递减
      e.recordInteraction("touch", T0 + i * 1500);
    }
    const { familiarity } = e.getState();
    // 第一击全量 0.02，其后逐次衰减；总和必 < 0.02*N
    expect(familiarity).toBeLessThan(BASE * N);
    expect(familiarity).toBeGreaterThan(BASE); // 仍累积了
  });
});

describe("多活跃日比单日高频点击贡献更大 (#6)", () => {
  it("分散在 5 个不同自然日的互动 > 集中在 1 天的等量互动", () => {
    const mk = () => new RelationshipEngine();
    // 单日：同一天 8 次 touch
    const single = mk();
    for (let i = 0; i < 8; i++) single.recordInteraction("touch", T0 + i * 1500);
    const singleFam = single.getState().familiarity;

    // 多日：5 个不同自然日，每日 2 次 touch
    const multi = mk();
    const DAY = 86_400_000;
    let t = T0;
    for (let d = 0; d < 5; d++) {
      multi.recordInteraction("touch", t);
      multi.recordInteraction("touch", t + 1500);
      t += DAY; // 跨到下一个自然日
    }
    const multiFam = multi.getState().familiarity;

    expect(multi.getState().activeDays).toBe(5);
    expect(multiFam).toBeGreaterThan(singleFam);
  });
});

describe("attachment 单会话不能显著增长 (#7)", () => {
  it("同一天内大量互动，attachment 仍接近 0", () => {
    const e = new RelationshipEngine();
    for (let i = 0; i < 30; i++) {
      e.recordInteraction(i % 2 === 0 ? "touch" : "speak", T0 + i * 2000);
    }
    const { attachment, activeDays } = e.getState();
    expect(activeDays).toBe(1); // 仍在单日
    expect(attachment).toBeLessThan(0.05); // 单会话不可显著形成依恋
  });
});

describe("短暂离开不降低 relationalTrust (#8)", () => {
  it("互动后 tickTime(<1天) 不衰减 trust", () => {
    const e = new RelationshipEngine();
    e.recordInteraction("touch", T0);
    e.recordInteraction("speak", T0 + 2000);
    const before = e.getState().relationalTrust;
    const r = e.tickTime(T0 + 3_600_000); // +1 小时
    expect(r.changed).toBe(false);
    expect(e.getState().relationalTrust).toBeCloseTo(before, 6);
  });
});

describe("长期未互动只产生极慢回落 (#9)", () => {
  it("互动后 30 天无互动，trust 仅极慢下降", () => {
    const e = new RelationshipEngine();
    e.recordInteraction("touch", T0);
    e.recordInteraction("speak", T0 + 2000);
    const before = e.getState().relationalTrust;
    const r = e.tickTime(T0 + 30 * 86_400_000);
    expect(r.changed).toBe(true);
    const drop = before - e.getState().relationalTrust;
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThan(0.1); // 30 天最多约 0.06，极慢
  });
});

describe("返回边沿判定 (isReturnEdge) — 必补边界", () => {
  it("首次非 AWAY 不算 return", () => {
    expect(isReturnEdge(null, "FOCUSED")).toBe(false);
    expect(isReturnEdge(null, "IDLE")).toBe(false);
  });
  it("AWAY → ACTIVE 算一次 return", () => {
    expect(isReturnEdge("AWAY", "FOCUSED")).toBe(true);
  });
  it("AWAY → IDLE 也算一次 return", () => {
    expect(isReturnEdge("AWAY", "IDLE")).toBe(true);
  });
  it("IDLE → ACTIVE 不重复算（未再次进入 AWAY）", () => {
    expect(isReturnEdge("IDLE", "FOCUSED")).toBe(false);
  });
  it("再次 AWAY 后回来才能再算一次", () => {
    expect(isReturnEdge("FOCUSED", "AWAY")).toBe(false); // 离开不算
    expect(isReturnEdge("AWAY", "FOCUSED")).toBe(true); // 再回来才算
  });

  it("完整焦点序列：仅 AWAY→非AWAY 边沿累计 returnCount", () => {
    const e = new RelationshipEngine();
    const seq: RelationshipFocusState[] = [
      "FOCUSED", // 首次，prev=null，不算
      "AWAY",
      "IDLE", // AWAY→IDLE 算一次
      "FOCUSED", // IDLE→FOCUSED 不算
      "FOCUSED", // 持续非 AWAY 不算
      "AWAY",
      "FOCUSED", // 再回来算一次
    ];
    let prev: RelationshipFocusState | null = null;
    let returns = 0;
    for (const cur of seq) {
      if (isReturnEdge(prev, cur)) {
        // 两次 return 必须跨出去重窗口（DEDUP_WINDOW_MS=1000），否则第二次会被去重
        e.recordInteraction("return", T0 + returns * 2000);
        returns++;
      }
      prev = cur;
    }
    expect(returns).toBe(2);
    expect(e.getHistory().returnCount).toBe(2);
  });
});

describe("会话计数语义", () => {
  it("recordSession 每次调用都 +1（同进程只调用一次由 LifeLoop 守卫保证）", () => {
    const e = new RelationshipEngine();
    e.recordSession(T0);
    e.recordSession(T0 + 1000);
    expect(e.getHistory().sessionCount).toBe(2);
  });
});

describe("重置（开发态 RESET RELATIONSHIP）", () => {
  it("reset 回到中性并清空历史", () => {
    const e = new RelationshipEngine();
    e.recordInteraction("touch", T0);
    e.recordInteraction("speak", T0 + 2000);
    e.reset();
    expect(e.getState().relationalTrust).toBe(0);
    expect(e.getState().familiarity).toBe(0);
    expect(e.getState().attachment).toBe(0);
    expect(e.getHistory().touchCount).toBe(0);
    expect(e.getHistory().conversationCount).toBe(0);
  });
});

describe("attachment 跨天形成", () => {
  it("多活跃日 + 高熟悉/信任 → attachment 显著 > 单日", () => {
    const e = new RelationshipEngine();
    const DAY = 86_400_000;
    let t = T0;
    for (let d = 0; d < 10; d++) {
      // 每天多次互动
      for (let i = 0; i < 5; i++) e.recordInteraction("touch", t + i * 2000);
      e.recordInteraction("speak", t + 12_000);
      t += DAY;
    }
    const { attachment, activeDays } = e.getState();
    expect(activeDays).toBe(10);
    expect(attachment).toBeGreaterThan(0.2); // 多日累积后依恋明显形成
    expect(attachment).toBeLessThanOrEqual(1);
  });
});
