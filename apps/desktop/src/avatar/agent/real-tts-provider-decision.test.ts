/**
 * Day13B — Real TTS Provider Decision 单测
 * 仅验证评估逻辑（不接真实 TTS、不创建音频对象、不写表情）。
 * 不引入 node: 内置模块（desktop tsconfig 不解析 node: 前缀），"不引真实 TTS 包"
 * 由 gate 静态扫描负责；本测试只做行为自包含与契约断言。
 */
import { describe, it, expect } from "vitest";
import {
  evaluateRealTtsProvider,
  rankRealTtsProviders,
  recommendNextProvider,
  type RealTtsProviderCandidate,
  type RealTtsProviderEvaluation,
  type RiskLevel,
  type RealTtsAudioOutput,
} from "./real-tts-provider-decision";

const CANDIDATES: ReadonlyArray<RealTtsProviderCandidate> = ["edge", "kokoro", "piper"];
const RISK_VALUES: ReadonlyArray<RiskLevel> = ["low", "medium", "high"];
const OUTPUT_VALUES: ReadonlyArray<RealTtsAudioOutput> = ["wav", "pcm", "audio-buffer", "unknown"];

describe("Day13B real TTS provider decision", () => {
  it("三候选均可 evaluate，且风险字段合法", () => {
    for (const c of CANDIDATES) {
      const e: RealTtsProviderEvaluation = evaluateRealTtsProvider(c);
      expect(e.candidate).toBe(c);
      expect(RISK_VALUES).toContain(e.licenseRisk);
      expect(RISK_VALUES).toContain(e.runtimeRisk);
      expect(RISK_VALUES).toContain(e.packagingRisk);
      expect(OUTPUT_VALUES).toContain(e.expectedAudioOutput);
      expect(typeof e.notes).toBe("string");
      expect(e.notes.length).toBeGreaterThan(0);
    }
  });

  it("rank 有稳定排序，且 edge 风险最高排末位", () => {
    const ranked = rankRealTtsProviders();
    expect(ranked).toHaveLength(3);
    // 末位必须是 edge（在线/高许可证风险，综合最差）
    expect(ranked[2].candidate).toBe("edge");
    // 首位必须是本地候选之一（kokoro / piper）
    expect(["kokoro", "piper"]).toContain(ranked[0].candidate);
    // 确定性：连续两次调用结果一致
    const again = rankRealTtsProviders();
    expect(again.map((x) => x.candidate)).toEqual(ranked.map((x) => x.candidate));
  });

  it("recommendNextProvider 不为空，且为三候选之一", () => {
    const next = recommendNextProvider();
    expect(CANDIDATES).toContain(next);
    expect(next.length).toBeGreaterThan(0);
  });

  it("决策模块自包含：三候选全评估不抛错、契约一致", () => {
    // 若模块误引入了不存在的真实 TTS 包，运行期会抛模块解析错误；
    // 此处遍历三候选确保 evaluate/rank/recommend 均可执行且返回结构一致。
    let count = 0;
    for (const c of CANDIDATES) {
      expect(() => evaluateRealTtsProvider(c)).not.toThrow();
      const e = evaluateRealTtsProvider(c);
      expect(typeof e.candidate).toBe("string");
      expect(typeof e.offlineSupport).toBe("boolean");
      expect(typeof e.browserSupport).toBe("boolean");
      count++;
    }
    expect(count).toBe(3);
    expect(() => rankRealTtsProviders()).not.toThrow();
    expect(() => recommendNextProvider()).not.toThrow();
  });

  it("风险字段取值均在合法枚举内（穷尽三候选）", () => {
    const all = rankRealTtsProviders();
    expect(all).toHaveLength(3);
    for (const e of all) {
      expect(RISK_VALUES).toContain(e.licenseRisk);
      expect(RISK_VALUES).toContain(e.runtimeRisk);
      expect(RISK_VALUES).toContain(e.packagingRisk);
      expect(OUTPUT_VALUES).toContain(e.expectedAudioOutput);
    }
  });
});
