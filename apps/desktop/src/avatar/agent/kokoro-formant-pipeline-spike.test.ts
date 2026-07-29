/**
 * Day14A — Kokoro Formant Pipeline Spike 测试
 *
 * 设计原则（符合 Day14A 验收标准）：
 * - 构造 / 空文本 / 结构合法 / cancel / reset 幂等 都必须稳定通过（不依赖真实依赖）。
 * - 真实依赖可用时尝试产出 active formant；不可用时 graceful skip。
 * - 不引入真实 TTS 包、不创建音频上下文、不驱动表情。
 */
import { describe, it, expect } from "vitest";
import { createKokoroProviderSpike, isKokoroInstalled } from "./kokoro-provider-spike";
import { createKokoroFormantPipelineSpike } from "./kokoro-formant-pipeline-spike";

describe("KokoroFormantPipelineSpike", () => {
  it("constructs without throwing", () => {
    const p = createKokoroProviderSpike();
    expect(() => createKokoroFormantPipelineSpike(p)).not.toThrow();
  });

  it("does not throw on empty text", async () => {
    const p = createKokoroProviderSpike();
    const pipe = createKokoroFormantPipelineSpike(p);
    await expect(pipe.speakAndAnalyze("")).resolves.toBeDefined();
    await expect(pipe.speakAndAnalyze("   ")).resolves.toBeDefined();
  });

  it("returns structurally valid result", async () => {
    const p = createKokoroProviderSpike();
    const pipe = createKokoroFormantPipelineSpike(p);
    const r = await pipe.speakAndAnalyze("hello world");
    expect(typeof r.sessionText).toBe("string");
    expect(Array.isArray(r.results)).toBe(true);
    expect(typeof r.activeCount).toBe("number");
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(typeof r.available).toBe("boolean");
  });

  it("cancel is idempotent", async () => {
    const p = createKokoroProviderSpike();
    const pipe = createKokoroFormantPipelineSpike(p);
    await pipe.speakAndAnalyze("hi");
    expect(() => pipe.cancel()).not.toThrow();
    expect(() => pipe.cancel()).not.toThrow();
  });

  it("reset is idempotent", async () => {
    const p = createKokoroProviderSpike();
    const pipe = createKokoroFormantPipelineSpike(p);
    await pipe.speakAndAnalyze("hi");
    expect(() => pipe.reset()).not.toThrow();
    expect(() => pipe.reset()).not.toThrow();
  });

  it("yields active formant when kokoro installed (skipped if not)", async () => {
    const available = await isKokoroInstalled();
    if (!available) return; // graceful skip：本机默认未安装 kokoro-js
    const p = createKokoroProviderSpike();
    const pipe = createKokoroFormantPipelineSpike(p);
    const r = await pipe.speakAndAnalyze("你好世界");
    expect(r).toBeDefined();
    // 真实后端存在且产出 PCM 时，应至少有一个有效帧
    if (r.available) {
      expect(r.results.length).toBeGreaterThan(0);
    }
  });
});
