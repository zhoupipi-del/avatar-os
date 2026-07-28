import { describe, it, expect } from "vitest";
import { AudioFixtureTtsProvider } from "./audio-fixture-tts-provider";
import {
  AudioFixtureFormantPipeline,
  createAudioFixtureFormantPipeline,
} from "./audio-fixture-formant-pipeline";
import { MOUTH_SHAPES } from "./formant-viseme-analyzer";

describe("createAudioFixtureFormantPipeline", () => {
  it("returns a usable pipeline bound to a fixture provider", () => {
    const provider = new AudioFixtureTtsProvider();
    const pipeline = createAudioFixtureFormantPipeline(provider);
    expect(pipeline).toBeInstanceOf(AudioFixtureFormantPipeline);
  });
});

describe("AudioFixtureFormantPipeline.speakAndAnalyze", () => {
  it("produces active formant results from fixture speech", () => {
    const pipeline = createAudioFixtureFormantPipeline(new AudioFixtureTtsProvider());
    const out = pipeline.speakAndAnalyze("你好世界", 12);
    expect(out.sessionText).toBe("你好世界");
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.activeCount).toBeGreaterThan(0);
  });

  it("covers all five vowel shapes across cycled frames", () => {
    const pipeline = createAudioFixtureFormantPipeline(new AudioFixtureTtsProvider());
    const out = pipeline.speakAndAnalyze("fixture-audio", 20);
    for (const shape of MOUTH_SHAPES) {
      const hit = out.results.some((r) => r.weights[shape] > 0);
      expect(hit).toBe(true);
    }
  });

  it("handles empty text gracefully without throwing", () => {
    const pipeline = createAudioFixtureFormantPipeline(new AudioFixtureTtsProvider());
    expect(() => pipeline.speakAndAnalyze("")).not.toThrow();
    const out = pipeline.speakAndAnalyze("");
    expect(out.sessionText).toBe("");
    expect(out.results.length).toBeGreaterThan(0);
  });

  it("reset clears probe state for a fresh run", () => {
    const pipeline = createAudioFixtureFormantPipeline(new AudioFixtureTtsProvider());
    const first = pipeline.speakAndAnalyze("reset-test", 8);
    expect(first.results.length).toBeGreaterThan(0);
    pipeline.reset();
    const second = pipeline.speakAndAnalyze("reset-test-2", 8);
    expect(second.results.length).toBeGreaterThan(0);
    expect(second.activeCount).toBeGreaterThan(0);
  });

  it("cancel is safe and allows a subsequent run", () => {
    const pipeline = createAudioFixtureFormantPipeline(new AudioFixtureTtsProvider());
    pipeline.speakAndAnalyze("cancel-test", 6);
    expect(() => pipeline.cancel()).not.toThrow();
    expect(() => pipeline.cancel()).not.toThrow();
    const after = pipeline.speakAndAnalyze("after-cancel", 6);
    expect(after.activeCount).toBeGreaterThan(0);
  });

  it("returns plain data results (no VRM / UI coupling)", () => {
    const pipeline = createAudioFixtureFormantPipeline(new AudioFixtureTtsProvider());
    const out = pipeline.speakAndAnalyze("data-shape", 10);
    for (const r of out.results) {
      expect(r).toHaveProperty("active");
      expect(r).toHaveProperty("weights");
      for (const shape of MOUTH_SHAPES) {
        expect(typeof r.weights[shape]).toBe("number");
      }
    }
  });
});
