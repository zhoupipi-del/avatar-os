import { describe, it, expect } from "vitest";
import {
  analyzeFormantViseme,
  findPeakInRange,
  computeVocalEnergy,
  MOUTH_SHAPES,
  type FormantAnalyzerInput,
} from "./formant-viseme-analyzer";

const SAMPLE_RATE = 44100;
const BIN_COUNT = 1024;

/** 构造频域数组：在 200~4000Hz 填 floor 基底，再把指定峰值写到对应 bin。 */
function buildSpectrum(peaks: { freq: number; amp: number }[], floor = 0): Uint8Array {
  const data = new Uint8Array(BIN_COUNT);
  const nyquist = SAMPLE_RATE / 2;
  const vStart = Math.max(0, Math.floor((200 / nyquist) * BIN_COUNT));
  const vEnd = Math.min(BIN_COUNT - 1, Math.floor((4000 / nyquist) * BIN_COUNT));
  for (let i = vStart; i <= vEnd; i++) data[i] = floor;
  for (const p of peaks) {
    const bin = Math.round((p.freq * 2 * BIN_COUNT) / SAMPLE_RATE);
    if (bin >= 0 && bin < BIN_COUNT) data[bin] = p.amp;
  }
  return data;
}

function makeInput(peaks: { freq: number; amp: number }[], floor = 25): FormantAnalyzerInput {
  return { frequencyData: buildSpectrum(peaks, floor), sampleRate: SAMPLE_RATE };
}

describe("formant-viseme-analyzer", () => {
  it("1) silence / low energy -> inactive, all weights 0", () => {
    const res = analyzeFormantViseme({ frequencyData: new Uint8Array(BIN_COUNT), sampleRate: SAMPLE_RATE });
    expect(res.active).toBe(false);
    for (const k of MOUTH_SHAPES) expect(res.weights[k]).toBe(0);
  });

  it("2) high F1 -> aa dominant", () => {
    const res = analyzeFormantViseme(makeInput([{ freq: 700, amp: 220 }]));
    expect(res.active).toBe(true);
    expect(res.weights.aa).toBeGreaterThan(0);
    expect(res.weights.aa).toBeGreaterThan(res.weights.ih);
    expect(res.weights.aa).toBeGreaterThan(res.weights.ou);
    expect(res.reason).toContain("aa");
  });

  it("3) low F1 + high F2 -> ih with a little ee", () => {
    const res = analyzeFormantViseme(
      makeInput([
        { freq: 250, amp: 220 },
        { freq: 2000, amp: 220 },
      ]),
    );
    expect(res.active).toBe(true);
    expect(res.weights.ih).toBeGreaterThan(0);
    expect(res.weights.ee).toBeGreaterThan(0);
    expect(res.weights.ih).toBeGreaterThan(res.weights.ee);
  });

  it("4) low F1 + low F2 -> ou", () => {
    const res = analyzeFormantViseme(
      makeInput([
        { freq: 250, amp: 220 },
        { freq: 1000, amp: 220 },
      ]),
    );
    expect(res.active).toBe(true);
    expect(res.weights.ou).toBeGreaterThan(0);
    expect(res.weights.ou).toBeGreaterThan(res.weights.ee);
  });

  it("5) mid F1 + high F2 -> ee with a little ih", () => {
    const res = analyzeFormantViseme(
      makeInput([
        { freq: 430, amp: 220 },
        { freq: 2000, amp: 220 },
      ]),
    );
    expect(res.active).toBe(true);
    expect(res.weights.ee).toBeGreaterThan(0);
    expect(res.weights.ih).toBeGreaterThan(0);
    expect(res.weights.ee).toBeGreaterThan(res.weights.ih);
  });

  it("6) invalid input does not throw", () => {
    expect(() => analyzeFormantViseme(null as unknown as FormantAnalyzerInput)).not.toThrow();
    expect(() => analyzeFormantViseme({} as unknown as FormantAnalyzerInput)).not.toThrow();
    expect(() =>
      analyzeFormantViseme({ frequencyData: new Uint8Array(0), sampleRate: SAMPLE_RATE }),
    ).not.toThrow();
    const r = analyzeFormantViseme(null as unknown as FormantAnalyzerInput);
    expect(r.active).toBe(false);
    for (const k of MOUTH_SHAPES) expect(r.weights[k]).toBe(0);
  });

  it("7) weights are clamped to [0,1]", () => {
    const res = analyzeFormantViseme(makeInput([{ freq: 700, amp: 255 }], 255));
    for (const k of MOUTH_SHAPES) {
      expect(res.weights[k]).toBeGreaterThanOrEqual(0);
      expect(res.weights[k]).toBeLessThanOrEqual(1);
    }
    expect(res.intensity).toBeLessThanOrEqual(1);
  });

  it("findPeakInRange returns freq within F1 band", () => {
    const peak = findPeakInRange(buildSpectrum([{ freq: 700, amp: 220 }]), SAMPLE_RATE, 200, 1000);
    expect(peak.freq).toBeGreaterThan(500);
    expect(peak.freq).toBeLessThan(1000);
  });

  it("computeVocalEnergy returns average in 0..255", () => {
    const e = computeVocalEnergy(buildSpectrum([{ freq: 700, amp: 200 }], 30), SAMPLE_RATE, 200, 4000);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThanOrEqual(255);
  });
});
