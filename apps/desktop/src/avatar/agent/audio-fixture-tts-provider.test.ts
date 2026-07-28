import { describe, it, expect } from "vitest";
import {
  AudioFixtureTtsProvider,
  AudioFixturePlaybackSession,
  createAudioFixtureTtsProvider,
} from "./audio-fixture-tts-provider";
import { FormantVisemeRuntimeProbe } from "./formant-viseme-runtime-probe";

describe("AudioFixtureTtsProvider capability", () => {
  it("exposes spectrum-source capability, no real audio", () => {
    const provider = new AudioFixtureTtsProvider();
    const cap = provider.getCapability();
    expect(cap.supportsAudioNode).toBe(false);
    expect(cap.supportsAudioBuffer).toBe(false);
    expect(cap.supportsPcm).toBe(false);
    expect(cap.supportsSpectrumSource).toBe(true);
  });

  it("is available and has identity", () => {
    const provider = new AudioFixtureTtsProvider();
    expect(provider.isAvailable()).toBe(true);
    expect(provider.id).toBeTruthy();
    expect(provider.name).toBeTruthy();
  });
});

describe("AudioFixtureTtsProvider.speak", () => {
  it("returns a playing session that echoes text", () => {
    const provider = new AudioFixtureTtsProvider();
    const session = provider.speak("你好世界") as AudioFixturePlaybackSession;
    expect(session).toBeInstanceOf(AudioFixturePlaybackSession);
    expect(session.getStatus()).toBe("playing");
    expect(session.text).toBe("你好世界");
    expect(session.getAudioNode()).toBeNull();
    expect(session.getAudioBuffer()).toBeNull();
    expect(session.getPcm()).toBeNull();
  });

  it("session cancel is safe and idempotent", () => {
    const provider = new AudioFixtureTtsProvider();
    const session = provider.speak("测试");
    expect(session.getStatus()).toBe("playing");
    session.cancel();
    expect(session.getStatus()).toBe("cancelled");
    expect(() => session.cancel()).not.toThrow();
    expect(session.getStatus()).toBe("cancelled");
  });

  it("spectrum source cycles through all five vowel shapes", () => {
    const provider = new AudioFixtureTtsProvider();
    const session = provider.speak("fixture") as AudioFixturePlaybackSession;
    const probe = new FormantVisemeRuntimeProbe(session.getSpectrumSource());
    const reasons = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const r = probe.update();
      if (r) reasons.add(r.reason);
    }
    expect(reasons.has("f1-high-aa")).toBe(true);
    expect(reasons.has("f1-low-f2-high-ih")).toBe(true);
    expect(reasons.has("f1-low-f2-low-ou")).toBe(true);
    expect(reasons.has("f2-high-ee")).toBe(true);
    expect(reasons.has("fallback-oh")).toBe(true);
  });

  it("handles empty / whitespace text without throwing", () => {
    const provider = new AudioFixtureTtsProvider();
    expect(() => provider.speak("")).not.toThrow();
    expect(() => provider.speak("   ")).not.toThrow();
    const empty = provider.speak("");
    expect(empty.getStatus()).toBe("playing");
    expect(empty.text).toBe("");
  });
});

describe("AudioFixtureTtsProvider.cancel", () => {
  it("is safe with or without an active session", () => {
    const provider = new AudioFixtureTtsProvider();
    expect(() => provider.cancel()).not.toThrow();
    provider.speak("x");
    expect(() => provider.cancel()).not.toThrow();
    expect(() => provider.cancel()).not.toThrow();
  });
});

describe("createAudioFixtureTtsProvider", () => {
  it("returns a usable provider", () => {
    const provider = createAudioFixtureTtsProvider({ sampleRate: 16000, binCount: 256 });
    const session = provider.speak("cfg") as AudioFixturePlaybackSession;
    const probe = new FormantVisemeRuntimeProbe(session.getSpectrumSource());
    const r = probe.update();
    expect(r?.active).toBe(true);
  });
});
