import { describe, it, expect } from "vitest";
import {
  LocalPcmFormantPipeline,
  createLocalPcmFormantPipeline,
} from "./local-pcm-formant-pipeline";
import { LocalPcmFixtureTtsProvider } from "./local-pcm-fixture-tts-provider";

describe("LocalPcmFormantPipeline", () => {
  it("speakAndAnalyze produces active formant results", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    const pipeline = new LocalPcmFormantPipeline(provider, { defaultFrameCount: 8 });
    const result = pipeline.speakAndAnalyze("你好世界");
    expect(result.sessionText).toBe("你好世界");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.activeCount).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("cancel is safe and idempotent", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    const pipeline = new LocalPcmFormantPipeline(provider);
    pipeline.speakAndAnalyze("cancel test");
    expect(() => pipeline.cancel()).not.toThrow();
    expect(() => pipeline.cancel()).not.toThrow();
  });

  it("reset is safe and idempotent", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    const pipeline = new LocalPcmFormantPipeline(provider);
    pipeline.speakAndAnalyze("reset test");
    expect(() => pipeline.reset()).not.toThrow();
    expect(() => pipeline.reset()).not.toThrow();
  });

  it("handles empty text without throwing", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    const pipeline = new LocalPcmFormantPipeline(provider);
    expect(() => pipeline.speakAndAnalyze("")).not.toThrow();
    const result = pipeline.speakAndAnalyze("");
    expect(result.sessionText).toBe("");
  });
});

describe("createLocalPcmFormantPipeline", () => {
  it("returns a usable pipeline", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    const pipeline = createLocalPcmFormantPipeline(provider, { defaultFrameCount: 5 });
    const result = pipeline.speakAndAnalyze("factory test");
    expect(result.results.length).toBeGreaterThan(0);
  });
});
