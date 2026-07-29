/**
 * Day13D — TTS Dependency Spike 单测
 * 仅验证评估逻辑（不接真实 TTS、不创建音频对象、不写表情）。
 * 不引入 node: 内置模块（desktop tsconfig 不解析 node: 前缀），"不引真实 TTS 包"
 * 由 gate 静态扫描负责；本测试只做行为自包含与契约断言。
 */
import { describe, it, expect } from "vitest";
import {
  evaluateTtsDependencyCandidate,
  rankTtsDependencyCandidates,
  recommendTtsDependencySpike,
  type TtsDependencyCandidate,
  type TtsDependencyProbeResult,
  type TtsDependencyRisk,
} from "./tts-dependency-spike";

const CANDIDATES: ReadonlyArray<TtsDependencyCandidate> = ["kokoro", "piper"];
const RISK_VALUES: ReadonlyArray<TtsDependencyRisk> = ["low", "medium", "high"];

describe("Day13D TTS dependency spike", () => {
  it("两个候选（kokoro / piper）均可 evaluate", () => {
    for (const c of CANDIDATES) {
      const r: TtsDependencyProbeResult = evaluateTtsDependencyCandidate(c);
      expect(r.candidate).toBe(c);
      expect(typeof r.packageAvailable).not.toBe("undefined");
      expect(typeof r.canRunInBrowser).not.toBe("undefined");
      expect(typeof r.canRunOffline).not.toBe("undefined");
      expect(typeof r.canOutputPcm).not.toBe("undefined");
      expect(typeof r.canOutputAudioBuffer).not.toBe("undefined");
      expect(typeof r.hasChineseVoice).not.toBe("undefined");
      expect(typeof r.recommendedNextAction).toBe("string");
      expect(r.recommendedNextAction.length).toBeGreaterThan(0);
      expect(typeof r.notes).toBe("string");
      expect(r.notes.length).toBeGreaterThan(0);
    }
  });

  it("rankTtsDependencyCandidates 稳定且包含两个候选", () => {
    const r1 = rankTtsDependencyCandidates();
    const r2 = rankTtsDependencyCandidates();
    expect(r1).toHaveLength(2);
    expect(r1.map((r) => r.candidate).sort()).toEqual(["kokoro", "piper"]);
    // 确定性：连续两次调用结果一致
    expect(r1.map((r) => r.candidate)).toEqual(r2.map((r) => r.candidate));
    // kokoro 应排首位（更低的风险 / 更确定的浏览器支持）
    expect(r1[0].candidate).toBe("kokoro");
  });

  it("recommendTtsDependencySpike 不为空且与 rank 首位一致", () => {
    const rec = recommendTtsDependencySpike();
    expect(rec).toBeDefined();
    expect(CANDIDATES).toContain(rec.candidate);
    expect(rec.candidate).toBe(rankTtsDependencyCandidates()[0].candidate);
  });

  it("风险字段合法（low / medium / high）", () => {
    const all = rankTtsDependencyCandidates();
    expect(all).toHaveLength(2);
    for (const r of all) {
      expect(RISK_VALUES).toContain(r.modelPackagingRisk);
      expect(RISK_VALUES).toContain(r.runtimeRisk);
    }
  });

  it("模块自包含：不依赖真实 TTS 包", () => {
    // 若模块误引入了不存在的真实 TTS 包，运行期会抛模块解析错误；
    // 此处遍历两候选确保 evaluate / rank / recommend 均可执行且返回结构一致。
    let count = 0;
    for (const c of CANDIDATES) {
      expect(() => evaluateTtsDependencyCandidate(c)).not.toThrow();
      const r = evaluateTtsDependencyCandidate(c);
      // 候选标识不含真实包后缀（-js / -tts）
      expect(r.candidate).not.toMatch(/-js$/);
      expect(r.candidate).not.toMatch(/-tts$/);
      count++;
    }
    expect(count).toBe(2);
    expect(() => rankTtsDependencyCandidates()).not.toThrow();
    expect(() => recommendTtsDependencySpike()).not.toThrow();
  });
});
