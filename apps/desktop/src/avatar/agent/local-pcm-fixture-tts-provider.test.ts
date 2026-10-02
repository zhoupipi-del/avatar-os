import { describe, it, expect } from "vitest";
import {
  LocalPcmFixtureTtsProvider,
  LocalPcmFixturePlaybackSession,
  createLocalPcmFixtureTtsProvider,
} from "./local-pcm-fixture-tts-provider";
import { FormantVisemeRuntimeProbe } from "./formant-viseme-runtime-probe";

describe("LocalPcmFixtureTtsProvider capability", () => {
  it("exposes PCM + spectrum-source capability, no real audio node/buffer", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    const cap = provider.getCapability();
    expect(cap.supportsAudioNode).toBe(false);
    expect(cap.supportsAudioBuffer).toBe(false);
    expect(cap.supportsPcm).toBe(true);
    expect(cap.supportsSpectrumSource).toBe(true);
  });

  it("is available and has identity", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    expect(provider.isAvailable()).toBe(true);
    expect(provider.id).toBeTruthy();
    expect(provider.name).toBeTruthy();
  });
});

describe("LocalPcmFixtureTtsProvider.speak", () => {
  it("returns a playing session with PCM data", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    const session = provider.speak("测试 PCM") as LocalPcmFixturePlaybackSession;
    expect(session).toBeInstanceOf(LocalPcmFixturePlaybackSession);
    expect(session.getStatus()).toBe("playing");
    expect(session.text).toBe("测试 PCM");
    expect(session.getAudioNode()).toBeNull();
    expect(session.getAudioBuffer()).toBeNull();

    const pcm = session.getPcm();
    expect(pcm).not.toBeNull();
    expect(pcm!.sampleRate).toBeGreaterThan(0);
    expect(pcm!.channels.length).toBeGreaterThan(0);
    expect(pcm!.channels[0].length).toBeGreaterThan(0);
  });

  it("session cancel is safe and idempotent", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    const session = provider.speak("cancel test");
    expect(session.getStatus()).toBe("playing");
    session.cancel();
    expect(session.getStatus()).toBe("cancelled");
    expect(() => session.cancel()).not.toThrow();
    expect(session.getStatus()).toBe("cancelled");
  });

  it("spectrum source produces active formant result", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    const session = provider.speak("元音测试") as LocalPcmFixturePlaybackSession;
    const source = session.getSpectrumSource();
    const probe = new FormantVisemeRuntimeProbe(source);
    const result = probe.update();
    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
  });

  it("handles empty / whitespace text without throwing", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    expect(() => provider.speak("")).not.toThrow();
    expect(() => provider.speak("   ")).not.toThrow();
    const empty = provider.speak("");
    expect(empty.getStatus()).toBe("playing");
    expect(empty.text).toBe("");
  });
});

describe("LocalPcmFixtureTtsProvider.cancel", () => {
  it("is safe with or without an active session", () => {
    const provider = new LocalPcmFixtureTtsProvider();
    expect(() => provider.cancel()).not.toThrow();
    provider.speak("x");
    expect(() => provider.cancel()).not.toThrow();
    expect(() => provider.cancel()).not.toThrow();
  });
});

describe("createLocalPcmFixtureTtsProvider", () => {
  it("returns a usable provider with custom sample rate", () => {
    const provider = createLocalPcmFixtureTtsProvider({ sampleRate: 16000 });
    const session = provider.speak("cfg") as LocalPcmFixturePlaybackSession;
    const pcm = session.getPcm();
    expect(pcm!.sampleRate).toBe(16000);
    const probe = new FormantVisemeRuntimeProbe(session.getSpectrumSource());
    const r = probe.update();
    expect(r?.active).toBe(true);
  });
});
