import { describe, expect, it } from "vitest";
import {
  CyclingFrequencySpectrumSource,
  StaticFrequencySpectrumSource,
  createSilentSpectrumSource,
} from "./audio-spectrum-source";
import { analyzeFormantViseme } from "./formant-viseme-analyzer";

const SAMPLE_RATE = 44100;
const BIN_COUNT = 512;
const NYQUIST = SAMPLE_RATE / 2;

/** 构造频谱 fixture：floor 为底噪，peaks 在指定频率处放峰值。 */
function makeSpectrum(peaks: Array<{ freq: number; amp: number }>, floor = 40): Uint8Array {
  const data = new Uint8Array(BIN_COUNT);
  // 人声频段 200–4000Hz 铺底噪，保证能量超过 noiseGate
  const start = Math.floor((200 / NYQUIST) * BIN_COUNT);
  const end = Math.floor((4000 / NYQUIST) * BIN_COUNT);
  for (let i = start; i <= end; i++) data[i] = floor;
  for (const { freq, amp } of peaks) {
    const bin = Math.floor((freq / NYQUIST) * BIN_COUNT);
    data[bin] = amp;
  }
  return data;
}

// 高 F1（~690Hz）→ aa
const AA_FRAME = makeSpectrum([{ freq: 700, amp: 220 }]);
// 低 F1（~260Hz）+ 高 F2（~1720Hz）→ ih
const IH_FRAME = makeSpectrum([
  { freq: 260, amp: 200 },
  { freq: 1720, amp: 180 },
]);
const SILENT_FRAME = new Uint8Array(BIN_COUNT);

describe("StaticFrequencySpectrumSource", () => {
  it("returns the same frame every call as a defensive copy", () => {
    const src = new StaticFrequencySpectrumSource(AA_FRAME, SAMPLE_RATE);
    const a = src.getFrequencyData();
    const b = src.getFrequencyData();
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // 副本，非同一引用
    a.fill(0);
    expect(src.getFrequencyData()).toEqual(b); // 修改副本不污染源
  });

  it("feeds analyzer: high F1 frame classifies as aa", () => {
    const src = new StaticFrequencySpectrumSource(AA_FRAME, SAMPLE_RATE);
    const result = analyzeFormantViseme({
      frequencyData: src.getFrequencyData(),
      sampleRate: src.sampleRate,
    });
    expect(result.active).toBe(true);
    expect(result.weights.aa).toBeGreaterThan(0);
    expect(result.reason).toBe("f1-high-aa");
  });

  it("normalizes non-Uint8Array input (clamp + round)", () => {
    const src = new StaticFrequencySpectrumSource([-5, 300, 12.6, Number.NaN], 44100);
    expect(Array.from(src.getFrequencyData())).toEqual([0, 255, 13, 0]);
  });
});

describe("createSilentSpectrumSource", () => {
  it("silent source yields inactive analyzer result", () => {
    const src = createSilentSpectrumSource();
    const result = analyzeFormantViseme({
      frequencyData: src.getFrequencyData(),
      sampleRate: src.sampleRate,
    });
    expect(result.active).toBe(false);
    expect(result.weights).toEqual({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
  });

  it("does not throw on invalid bin count / sample rate", () => {
    expect(() => createSilentSpectrumSource(-1, -1)).not.toThrow();
    const src = createSilentSpectrumSource(0, Number.NaN);
    expect(src.getFrequencyData().length).toBeGreaterThan(0);
  });
});

describe("CyclingFrequencySpectrumSource", () => {
  it("cycles through frames and wraps around", () => {
    const src = new CyclingFrequencySpectrumSource([AA_FRAME, SILENT_FRAME, IH_FRAME], SAMPLE_RATE);
    expect(src.getCursor()).toBe(0);
    const first = src.getFrequencyData();
    const second = src.getFrequencyData();
    const third = src.getFrequencyData();
    const wrapped = src.getFrequencyData();
    expect(first).toEqual(new Uint8Array(AA_FRAME));
    expect(second).toEqual(SILENT_FRAME);
    expect(third).toEqual(new Uint8Array(IH_FRAME));
    expect(wrapped).toEqual(first); // 回绕
  });

  it("produces different analyzer classifications across frames", () => {
    const src = new CyclingFrequencySpectrumSource([AA_FRAME, SILENT_FRAME, IH_FRAME], SAMPLE_RATE);
    const r1 = analyzeFormantViseme({ frequencyData: src.getFrequencyData(), sampleRate: src.sampleRate });
    const r2 = analyzeFormantViseme({ frequencyData: src.getFrequencyData(), sampleRate: src.sampleRate });
    const r3 = analyzeFormantViseme({ frequencyData: src.getFrequencyData(), sampleRate: src.sampleRate });
    expect(r1.reason).toBe("f1-high-aa");
    expect(r2.active).toBe(false);
    expect(r3.reason).toBe("f1-low-f2-high-ih");
  });

  it("resetCursor rewinds to frame 0 and empty frames do not throw", () => {
    const src = new CyclingFrequencySpectrumSource([AA_FRAME, SILENT_FRAME], SAMPLE_RATE);
    src.getFrequencyData();
    expect(src.getCursor()).toBe(1);
    src.resetCursor();
    expect(src.getCursor()).toBe(0);

    const empty = new CyclingFrequencySpectrumSource([], 44100);
    expect(() => empty.getFrequencyData()).not.toThrow();
    expect(empty.getFrequencyData().length).toBe(0);
  });
});
