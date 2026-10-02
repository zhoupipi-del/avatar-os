import { describe, it, expect } from "vitest";
import { WebAudioSpectrumSource } from "./web-audio-spectrum-source";

function buildSpectrum(
  sampleRate: number,
  binCount: number,
  peaks: Array<{ freq: number; amp: number }>,
): Uint8Array {
  const data = new Uint8Array(binCount);
  const nyquist = sampleRate / 2;
  for (const { freq, amp } of peaks) {
    const bin = Math.round((freq / nyquist) * binCount);
    if (bin >= 0 && bin < binCount) data[bin] = Math.max(0, Math.min(255, amp));
  }
  return data;
}

function fakePullFrom(spectrum: Uint8Array): (data: Uint8Array) => void {
  return (data: Uint8Array) => {
    const n = Math.min(data.length, spectrum.length);
    for (let i = 0; i < n; i++) data[i] = spectrum[i];
  };
}

describe("WebAudioSpectrumSource", () => {
  const sampleRate = 44100;
  const binCount = 1024;

  it("getFrequencyData returns a Uint8Array of length frequencyBinCount", () => {
    const spectrum = buildSpectrum(sampleRate, binCount, [{ freq: 700, amp: 200 }]);
    const src = new WebAudioSpectrumSource({
      sampleRate,
      frequencyBinCount: binCount,
      pullFrequencyData: fakePullFrom(spectrum),
    });
    const out = src.getFrequencyData();
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(binCount);
    const bin = Math.round((700 / (sampleRate / 2)) * binCount);
    expect(out[bin]).toBe(200);
  });

  it("invokes pullFrequencyData on each getFrequencyData call", () => {
    let calls = 0;
    const src = new WebAudioSpectrumSource({
      sampleRate,
      frequencyBinCount: binCount,
      pullFrequencyData: (data) => {
        calls++;
        data.fill(0);
      },
    });
    src.getFrequencyData();
    src.getFrequencyData();
    expect(calls).toBe(2);
  });

  it("returns a defensive copy (mutating returned array does not affect next call)", () => {
    const spectrum = buildSpectrum(sampleRate, binCount, [{ freq: 700, amp: 200 }]);
    const src = new WebAudioSpectrumSource({
      sampleRate,
      frequencyBinCount: binCount,
      pullFrequencyData: fakePullFrom(spectrum),
    });
    const first = src.getFrequencyData();
    first[0] = 255; // 污染副本
    const second = src.getFrequencyData();
    expect(second[0]).toBe(0); // 内部状态未被污染
  });

  it("does not throw and returns zeros when pullFrequencyData throws", () => {
    const src = new WebAudioSpectrumSource({
      sampleRate,
      frequencyBinCount: binCount,
      pullFrequencyData: () => {
        throw new Error("boom");
      },
    });
    let out: Uint8Array = new Uint8Array(0);
    expect(() => {
      out = src.getFrequencyData();
    }).not.toThrow();
    expect(out.length).toBe(binCount);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it("dispose is safe to call repeatedly", () => {
    let disposed = 0;
    const src = new WebAudioSpectrumSource({
      sampleRate,
      frequencyBinCount: binCount,
      pullFrequencyData: (d) => d.fill(0),
      dispose: () => {
        disposed++;
      },
    });
    expect(() => {
      src.dispose();
      src.dispose();
    }).not.toThrow();
    expect(disposed).toBe(2);
  });

  it("stores the provided sampleRate", () => {
    const src = new WebAudioSpectrumSource({
      sampleRate,
      frequencyBinCount: binCount,
      pullFrequencyData: (d) => d.fill(0),
    });
    expect(src.sampleRate).toBe(sampleRate);
  });

  it("does not require a real AudioContext to function (DI only)", () => {
    // 关键断言：整个模块在测试里从不实例化任何 Web Audio 节点（音频上下文 / 分析节点 / 音频元素）
    // 全部依赖注入；此测试本身不创建任何音频对象。
    const src = new WebAudioSpectrumSource({
      sampleRate,
      frequencyBinCount: binCount,
      pullFrequencyData: (d) => {
        d.fill(0);
        const bin = Math.round((700 / (sampleRate / 2)) * binCount);
        d[bin] = 220;
      },
    });
    const out = src.getFrequencyData();
    const bin = Math.round((700 / (sampleRate / 2)) * binCount);
    expect(out[bin]).toBe(220);
  });
});
