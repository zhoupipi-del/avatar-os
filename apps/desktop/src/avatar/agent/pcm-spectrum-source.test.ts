import { describe, it, expect } from "vitest";
import { PcmSpectrumSource, buildSyntheticVowelPcm } from "./pcm-spectrum-source";
import { analyzeFormantViseme } from "./formant-viseme-analyzer";

describe("PcmSpectrumSource", () => {
  it("silent PCM produces inactive formant result", () => {
    const silentPcm = new Float32Array(44100); // 1 second of silence
    const source = new PcmSpectrumSource({
      sampleRate: 44100,
      channelData: silentPcm,
    });
    const freqData = source.getFrequencyData();
    expect(freqData).toBeInstanceOf(Uint8Array);
    expect(freqData.length).toBe(512);
    const result = analyzeFormantViseme({ frequencyData: freqData, sampleRate: 44100 });
    expect(result.active).toBe(false);
  });

  it("synthetic high-F1 vowel PCM produces aa", () => {
    const pcm = buildSyntheticVowelPcm(44100, 500, 700, 2000);
    const source = new PcmSpectrumSource({
      sampleRate: 44100,
      channelData: pcm,
    });
    const freqData = source.getFrequencyData();
    expect(freqData).toBeInstanceOf(Uint8Array);
    const result = analyzeFormantViseme({ frequencyData: freqData, sampleRate: 44100 });
    expect(result.active).toBe(true);
    expect(result.reason).toBe("f1-high-aa");
  });

  it("synthetic low-F1 high-F2 vowel PCM produces ih", () => {
    const pcm = buildSyntheticVowelPcm(44100, 500, 300, 2200);
    const source = new PcmSpectrumSource({
      sampleRate: 44100,
      channelData: pcm,
    });
    const freqData = source.getFrequencyData();
    expect(freqData).toBeInstanceOf(Uint8Array);
    const result = analyzeFormantViseme({ frequencyData: freqData, sampleRate: 44100 });
    expect(result.active).toBe(true);
    expect(result.reason).toBe("f1-low-f2-high-ih");
  });
});
