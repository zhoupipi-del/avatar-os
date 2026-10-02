/**
 * Day14D — Kokoro Output Normalizer 单元测试
 *
 * 全部离线纯数据测试：不下载模型、不发网络请求、不创建音频对象。
 */
import { describe, expect, it } from "vitest";
import {
  KOKORO_DEFAULT_SAMPLE_RATE,
  extractFloat32Audio,
  extractSampleRate,
  normalizeKokoroAudioOutput,
} from "./kokoro-output-normalizer";

function makePcm(n = 256): Float32Array {
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.sin((2 * Math.PI * i) / 32) * 0.5;
  return pcm;
}

describe("normalizeKokoroAudioOutput", () => {
  it("normalizes a bare Float32Array with fallback sample rate", () => {
    const pcm = makePcm();
    const r = normalizeKokoroAudioOutput(pcm);
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.pcm).not.toBeNull();
    expect(r.pcm!.sampleRate).toBe(KOKORO_DEFAULT_SAMPLE_RATE);
    expect(r.pcm!.channels.length).toBe(1);
    expect(r.pcm!.channels[0]).toBe(pcm);
    expect(r.pcm!.frameCount).toBe(256);
    expect(r.pcm!.durationMs).toBeCloseTo((256 / 24000) * 1000, 5);
    expect(r.pcm!.sourceShape).toBe("float32-array");
  });

  it("normalizes a plain number[] into Float32Array", () => {
    const r = normalizeKokoroAudioOutput([0.1, -0.2, 0.3, -0.4]);
    expect(r.ok).toBe(true);
    expect(r.pcm!.channels[0]).toBeInstanceOf(Float32Array);
    expect(r.pcm!.frameCount).toBe(4);
    expect(r.pcm!.sourceShape).toBe("number-array");
  });

  it("normalizes RawAudio shape { audio, sampling_rate }", () => {
    const pcm = makePcm(480);
    const r = normalizeKokoroAudioOutput({ audio: pcm, sampling_rate: 24000 });
    expect(r.ok).toBe(true);
    expect(r.pcm!.sampleRate).toBe(24000);
    expect(r.pcm!.frameCount).toBe(480);
    expect(r.pcm!.durationMs).toBeCloseTo(20, 5);
    expect(r.pcm!.sourceShape).toBe("object.audio:float32-array");
  });

  it("normalizes nested RawAudio wrapper { audio: { audio, sampling_rate } }", () => {
    const pcm = makePcm(128);
    const r = normalizeKokoroAudioOutput({ audio: { audio: pcm, sampling_rate: 22050 } });
    expect(r.ok).toBe(true);
    expect(r.pcm!.sampleRate).toBe(22050);
    expect(r.pcm!.channels[0]).toBe(pcm);
    expect(r.pcm!.sourceShape).toBe("object.audio.audio:float32-array");
  });

  it("normalizes alternate key shapes: pcm/sampleRate, data/sample_rate, samples/sr", () => {
    const pcm = makePcm(64);

    const r1 = normalizeKokoroAudioOutput({ pcm, sampleRate: 16000 });
    expect(r1.ok).toBe(true);
    expect(r1.pcm!.sampleRate).toBe(16000);
    expect(r1.pcm!.sourceShape).toBe("object.pcm:float32-array");

    const r2 = normalizeKokoroAudioOutput({ data: pcm, sample_rate: 44100 });
    expect(r2.ok).toBe(true);
    expect(r2.pcm!.sampleRate).toBe(44100);
    expect(r2.pcm!.sourceShape).toBe("object.data:float32-array");

    const r3 = normalizeKokoroAudioOutput({ samples: [0.1, 0.2, 0.3], sr: 8000 });
    expect(r3.ok).toBe(true);
    expect(r3.pcm!.sampleRate).toBe(8000);
    expect(r3.pcm!.channels[0]).toBeInstanceOf(Float32Array);
    expect(r3.pcm!.sourceShape).toBe("object.samples:number-array");
  });

  it("returns structured failure (never throws) on invalid outputs", () => {
    for (const bad of [null, undefined, 42, "audio", {}, { foo: "bar" }, new Float32Array(0), []]) {
      const r = normalizeKokoroAudioOutput(bad);
      expect(r.ok).toBe(false);
      expect(r.pcm).toBeNull();
      expect(typeof r.error).toBe("string");
    }
  });

  it("uses options.fallbackSampleRate when output carries no sample rate", () => {
    const r = normalizeKokoroAudioOutput(makePcm(32), { fallbackSampleRate: 48000 });
    expect(r.ok).toBe(true);
    expect(r.pcm!.sampleRate).toBe(48000);
  });
});

describe("extractSampleRate / extractFloat32Audio", () => {
  it("extractSampleRate falls back for non-object and rejects non-positive values", () => {
    expect(extractSampleRate(null)).toBe(KOKORO_DEFAULT_SAMPLE_RATE);
    expect(extractSampleRate({ sampling_rate: -1 })).toBe(KOKORO_DEFAULT_SAMPLE_RATE);
    expect(extractSampleRate({ sampling_rate: 24000 })).toBe(24000);
    expect(extractSampleRate({ audio: { sampleRate: 16000 } })).toBe(16000);
    expect(extractSampleRate("x", 32000)).toBe(32000);
  });

  it("extractFloat32Audio returns null for unrecognizable payloads", () => {
    expect(extractFloat32Audio(null)).toBeNull();
    expect(extractFloat32Audio({ text: "hi" })).toBeNull();
    expect(extractFloat32Audio(new Float32Array(0))).toBeNull();
  });
});
