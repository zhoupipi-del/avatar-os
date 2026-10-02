import { describe, expect, it } from "vitest";
import {
  CyclingFrequencySpectrumSource,
  StaticFrequencySpectrumSource,
  createSilentSpectrumSource,
  type AudioSpectrumSource,
} from "./audio-spectrum-source";
import { FormantVisemeRuntimeProbe } from "./formant-viseme-runtime-probe";

const SAMPLE_RATE = 44100;
const BIN_COUNT = 512;
const NYQUIST = SAMPLE_RATE / 2;

function makeSpectrum(peaks: Array<{ freq: number; amp: number }>, floor = 40): Uint8Array {
  const data = new Uint8Array(BIN_COUNT);
  const start = Math.floor((200 / NYQUIST) * BIN_COUNT);
  const end = Math.floor((4000 / NYQUIST) * BIN_COUNT);
  for (let i = start; i <= end; i++) data[i] = floor;
  for (const { freq, amp } of peaks) {
    data[Math.floor((freq / NYQUIST) * BIN_COUNT)] = amp;
  }
  return data;
}

const AA_FRAME = makeSpectrum([{ freq: 700, amp: 220 }]);
const IH_FRAME = makeSpectrum([
  { freq: 260, amp: 200 },
  { freq: 1720, amp: 180 },
]);
const SILENT_FRAME = new Uint8Array(BIN_COUNT);

describe("FormantVisemeRuntimeProbe", () => {
  it("silent source → inactive result, status reflects it", () => {
    const probe = new FormantVisemeRuntimeProbe(createSilentSpectrumSource());
    const result = probe.update();
    expect(result).not.toBeNull();
    expect(result!.active).toBe(false);
    const status = probe.getStatus();
    expect(status.active).toBe(false);
    expect(status.updateCount).toBe(1);
    expect(status.lastReason).toBe("silence-or-low-energy");
  });

  it("high F1 source → aa classification", () => {
    const probe = new FormantVisemeRuntimeProbe(
      new StaticFrequencySpectrumSource(AA_FRAME, SAMPLE_RATE),
    );
    const result = probe.update();
    expect(result!.active).toBe(true);
    expect(result!.weights.aa).toBeGreaterThan(0);
    expect(probe.getStatus().lastReason).toBe("f1-high-aa");
  });

  it("cycling source → classification changes across updates", () => {
    const probe = new FormantVisemeRuntimeProbe(
      new CyclingFrequencySpectrumSource([AA_FRAME, SILENT_FRAME, IH_FRAME], SAMPLE_RATE),
    );
    const r1 = probe.update();
    const r2 = probe.update();
    const r3 = probe.update();
    expect(r1!.reason).toBe("f1-high-aa");
    expect(r2!.active).toBe(false);
    expect(r3!.reason).toBe("f1-low-f2-high-ih");
    expect(probe.getStatus().updateCount).toBe(3);
    expect(probe.getStatus().lastReason).toBe("f1-low-f2-high-ih");
  });

  it("updateCount accumulates and reset clears state but keeps source", () => {
    const probe = new FormantVisemeRuntimeProbe(
      new StaticFrequencySpectrumSource(AA_FRAME, SAMPLE_RATE),
    );
    probe.update();
    probe.update();
    expect(probe.getStatus().updateCount).toBe(2);
    probe.reset();
    const status = probe.getStatus();
    expect(status.updateCount).toBe(0);
    expect(status.lastResult).toBeNull();
    expect(status.lastReason).toBe("no-update");
    // source 保留，update 仍可用
    expect(probe.update()).not.toBeNull();
    expect(probe.getStatus().updateCount).toBe(1);
  });

  it("cancel disconnects source and clears state", () => {
    const probe = new FormantVisemeRuntimeProbe(
      new StaticFrequencySpectrumSource(AA_FRAME, SAMPLE_RATE),
    );
    probe.update();
    probe.cancel();
    expect(probe.getStatus().updateCount).toBe(0);
    expect(probe.getStatus().lastResult).toBeNull();
    expect(probe.update()).toBeNull(); // 已断开
  });

  it("no source / throwing source / invalid data do not throw", () => {
    const noSource = new FormantVisemeRuntimeProbe(null);
    expect(() => noSource.update()).not.toThrow();
    expect(noSource.update()).toBeNull();
    expect(noSource.getStatus().updateCount).toBe(0);

    const throwing: AudioSpectrumSource = {
      sampleRate: 44100,
      getFrequencyData() {
        throw new Error("boom");
      },
    };
    const probe = new FormantVisemeRuntimeProbe(throwing);
    expect(() => probe.update()).not.toThrow();
    expect(probe.update()).toBeNull();

    // 非法数据（空数组 / 无效采样率）→ analyzer 返回 invalid-input，不 throw
    const invalid = new FormantVisemeRuntimeProbe(
      new StaticFrequencySpectrumSource([], 0),
    );
    const result = invalid.update();
    expect(result).not.toBeNull();
    expect(result!.active).toBe(false);
    expect(result!.reason).toBe("invalid-input");
  });

  it("setSource swaps the source at runtime", () => {
    const probe = new FormantVisemeRuntimeProbe(createSilentSpectrumSource());
    expect(probe.update()!.active).toBe(false);
    probe.setSource(new StaticFrequencySpectrumSource(AA_FRAME, SAMPLE_RATE));
    expect(probe.update()!.reason).toBe("f1-high-aa");
    probe.setSource(null);
    expect(probe.update()).toBeNull();
  });
});
