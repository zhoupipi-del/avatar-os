import { describe, it, expect } from "vitest";
import { WebAudioSpectrumSource } from "./web-audio-spectrum-source";
import { WebAudioFormantProbe, createWebAudioFormantProbe } from "./web-audio-formant-probe";

function buildSpectrum(
  sampleRate: number,
  binCount: number,
  peaks: Array<{ freq: number; amp: number }>,
  floor = 40,
): Uint8Array {
  const data = new Uint8Array(binCount);
  const nyquist = sampleRate / 2;
  // 人声频段 200–4000Hz 铺底噪，保证能量超过 noiseGate（与 Day11C 测试一致）
  const start = Math.floor((200 / nyquist) * binCount);
  const end = Math.floor((4000 / nyquist) * binCount);
  for (let i = start; i <= end; i++) data[i] = floor;
  for (const { freq, amp } of peaks) {
    const bin = Math.round((freq / nyquist) * binCount);
    if (bin >= 0 && bin < binCount) data[bin] = Math.max(0, Math.min(255, amp));
  }
  return data;
}

function makeSource(
  peaks: Array<{ freq: number; amp: number }>,
  sampleRate = 44100,
  binCount = 1024,
): WebAudioSpectrumSource {
  const spectrum = buildSpectrum(sampleRate, binCount, peaks);
  return new WebAudioSpectrumSource({
    sampleRate,
    frequencyBinCount: binCount,
    pullFrequencyData: (data) => {
      const n = Math.min(data.length, spectrum.length);
      for (let i = 0; i < n; i++) data[i] = spectrum[i];
    },
  });
}

describe("WebAudioFormantProbe", () => {
  const sampleRate = 44100;
  const binCount = 1024;

  it("high F1 (e.g. 700Hz) → aa weight > 0, active true", () => {
    const src = makeSource([{ freq: 700, amp: 220 }], sampleRate, binCount);
    const probe = new WebAudioFormantProbe(src);
    const result = probe.update();
    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.weights.aa).toBeGreaterThan(0);
  });

  it("low F1 + high F2 → ih weight > 0", () => {
    const src = makeSource(
      [
        { freq: 260, amp: 220 },
        { freq: 1720, amp: 220 },
      ],
      sampleRate,
      binCount,
    );
    const probe = new WebAudioFormantProbe(src);
    const result = probe.update();
    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.weights.ih).toBeGreaterThan(0);
  });

  it("silent spectrum → inactive, all weights zero", () => {
    const src = new WebAudioSpectrumSource({
      sampleRate,
      frequencyBinCount: binCount,
      pullFrequencyData: (d) => d.fill(0),
    });
    const probe = new WebAudioFormantProbe(src);
    const result = probe.update();
    expect(result).not.toBeNull();
    expect(result!.active).toBe(false);
    const sum =
      result!.weights.aa +
      result!.weights.ih +
      result!.weights.ou +
      result!.weights.ee +
      result!.weights.oh;
    expect(sum).toBe(0);
  });

  it("updateCount increments per update", () => {
    const src = makeSource([{ freq: 700, amp: 220 }], sampleRate, binCount);
    const probe = new WebAudioFormantProbe(src);
    expect(probe.getStatus().updateCount).toBe(0);
    probe.update();
    probe.update();
    expect(probe.getStatus().updateCount).toBe(2);
  });

  it("getStatus exposes sourceSampleRate", () => {
    const src = makeSource([{ freq: 700, amp: 220 }], sampleRate, binCount);
    const probe = new WebAudioFormantProbe(src);
    expect(probe.getStatus().sourceSampleRate).toBe(sampleRate);
  });

  it("dispose is safe to call repeatedly", () => {
    let disposed = 0;
    const srcWithDispose = new WebAudioSpectrumSource({
      sampleRate,
      frequencyBinCount: binCount,
      pullFrequencyData: (d) => d.fill(0),
      dispose: () => {
        disposed++;
      },
    });
    const probe = new WebAudioFormantProbe(srcWithDispose);
    expect(() => {
      probe.dispose();
      probe.dispose();
    }).not.toThrow();
    expect(disposed).toBe(2);
  });

  it("createWebAudioFormantProbe factory produces a working probe (high F1 → aa)", () => {
    const src = makeSource([{ freq: 700, amp: 220 }], sampleRate, binCount);
    const probe = createWebAudioFormantProbe(src);
    const result = probe.update();
    expect(result).not.toBeNull();
    expect(result!.weights.aa).toBeGreaterThan(0);
  });
});
