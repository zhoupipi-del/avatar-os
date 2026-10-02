import { describe, it, expect } from "vitest";
import { normalizeIntent, isDispatchable, type NormalizedIntent } from "../src/intent-normalizer";

describe("IntentNormalizer (v0.3-M1 观察优先)", () => {
  it("L1 格式清洗：trim / 大写 / 去引号 / 折叠空白", () => {
    expect(normalizeIntent(" greet ").normalized).toBe("GREET");
    expect(normalizeIntent("greet\n").normalized).toBe("GREET");
    expect(normalizeIntent('"greeting"').normalized).toBe("GREET");
    expect(normalizeIntent("  GREETING  ").normalized).toBe("GREET");
  });

  it("L2 显式别名：同义归一（中英文 / 口语）", () => {
    expect(normalizeIntent("greeting").normalized).toBe("GREET");
    expect(normalizeIntent("你好").normalized).toBe("GREET");
    expect(normalizeIntent("打招呼").normalized).toBe("GREET");
    expect(normalizeIntent("伸懒腰").normalized).toBe("STRETCH");
    expect(normalizeIntent("打盹").normalized).toBe("DOZE");
    expect(normalizeIntent("偷看").normalized).toBe("PEEK");
    expect(normalizeIntent("看过来").normalized).toBe("LOOK_AT_USER");
  });

  it("L3 未知保留为 UNKNOWN，且 raw 永不丢失", () => {
    const r = normalizeIntent("social_contact");
    expect(r.normalized).toBe("UNKNOWN");
    expect(r.matched).toBe(false);
    expect(r.raw).toBe("social_contact");
    // 多词无别名也应保 raw
    expect(normalizeIntent("陪我聊聊天").raw).toBe("陪我聊聊天");
  });

  it("NONE vs UNKNOWN 语义区分", () => {
    // NONE：模型【明确】无动作（省略字段 / "无" / "none"）
    expect(normalizeIntent("none").normalized).toBe("NONE");
    expect(normalizeIntent("无").normalized).toBe("NONE");
    expect(normalizeIntent(undefined).normalized).toBe("NONE");
    expect(normalizeIntent("").normalized).toBe("NONE");
    // UNKNOWN：系统【不认识】（进了日志待训练，但不等于"无动作"）
    expect(normalizeIntent("陪伴一下").normalized).toBe("UNKNOWN");
    expect(normalizeIntent("social_contact").normalized).toBe("UNKNOWN");
  });

  it("isDispatchable：只有合法物理意图才驱动身体", () => {
    expect(isDispatchable("GREET" as NormalizedIntent)).toBe(true);
    expect(isDispatchable("STRETCH" as NormalizedIntent)).toBe(true);
    expect(isDispatchable("NONE")).toBe(false);
    expect(isDispatchable("UNKNOWN")).toBe(false);
  });

  it("永远不抛异常（ robustness 红线）", () => {
    expect(() => normalizeIntent(null)).not.toThrow();
    expect(() => normalizeIntent(undefined)).not.toThrow();
    expect(() => normalizeIntent("🤪🔥")).not.toThrow();
    expect(normalizeIntent("🤪🔥").normalized).toBe("UNKNOWN");
  });
});
