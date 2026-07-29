/**
 * Day14D — Kokoro Normalized Formant Pipeline 单元测试
 *
 * 用 Day13C 的合成元音 PCM 模拟"归一化后的 kokoro 输出"，全程离线：
 * 不下载模型、不发网络请求、不创建音频对象。
 */
import { describe, expect, it } from "vitest";
import {
  KokoroNormalizedFormantPipeline,
  analyzeNormalizedKokoroOutput,
  createKokoroNormalizedFormantPipeline,
} from "./kokoro-normalized-formant-pipeline";
import { buildSyntheticVowelPcm } from "./pcm-spectrum-source";

const SAMPLE_RATE = 24000;

describe("analyzeNormalizedKokoroOutput", () => {
  it("analyzes synthetic vowel PCM in RawAudio shape and reports active formant results", () => {
    // aa 元音特征：F1 高（~800Hz）
    const pcm = buildSyntheticVowelPcm(SAMPLE_RATE, 500, 800, 1200);
    const summary = analyzeNormalizedKokoroOutput({ audio: pcm, sampling_rate: SAMPLE_RATE });

    expect(summary.normalized).toBe(true);
    expect(summary.error).toBeNull();
    expect(summary.sampleRate).toBe(SAMPLE_RATE);
    expect(summary.frameCount).toBeGreaterThan(0);
    expect(summary.activeResultCount).toBeGreaterThan(0);
    expect(summary.dominantShapes.length).toBeGreaterThan(0);
    expect(summary.dominantShapes).toContain("aa");
    expect(summary.reasons).toContain("f1-high-aa");
    expect(summary.results.every((r) => r.active)).toBe(true);
  });

  it("returns structured failure (never throws) for invalid outputs", () => {
    for (const bad of [null, undefined, {}, "nope", new Float32Array(0)]) {
      const summary = analyzeNormalizedKokoroOutput(bad);
      expect(summary.normalized).toBe(false);
      expect(summary.frameCount).toBe(0);
      expect(summary.activeResultCount).toBe(0);
      expect(typeof summary.error).toBe("string");
    }
  });

  it("honors maxFrames and frameSize options", () => {
    const pcm = buildSyntheticVowelPcm(SAMPLE_RATE, 1000, 300, 2000); // ih 特征
    const summary = analyzeNormalizedKokoroOutput(pcm, { maxFrames: 3, frameSize: 2048 });
    expect(summary.normalized).toBe(true);
    expect(summary.frameCount).toBeLessThanOrEqual(3);
  });
});

describe("KokoroNormalizedFormantPipeline", () => {
  it("analyzes repeatedly with idempotent reset", () => {
    const pipeline = createKokoroNormalizedFormantPipeline({ maxFrames: 8 });
    expect(pipeline).toBeInstanceOf(KokoroNormalizedFormantPipeline);

    const pcm = buildSyntheticVowelPcm(SAMPLE_RATE, 400, 300, 800); // ou 特征
    const s1 = pipeline.analyze({ audio: pcm, sampling_rate: SAMPLE_RATE });
    pipeline.reset();
    pipeline.reset(); // 幂等
    const s2 = pipeline.analyze({ audio: pcm, sampling_rate: SAMPLE_RATE });

    expect(s1.normalized).toBe(true);
    expect(s2.normalized).toBe(true);
    expect(s2.activeResultCount).toBe(s1.activeResultCount);
    expect(s2.dominantShapes).toEqual(s1.dominantShapes);
  });
});
