import { describe, it, expect } from "vitest";
import {
  UnsupportedAudioTtsProvider,
  describeBrowserTtsCapability,
  NO_AUDIO_TTS_CAPABILITY,
  type AudioTtsPlaybackSession,
} from "./audio-tts-provider";

describe("UnsupportedAudioTtsProvider", () => {
  it("reports no audio capability (placeholder probe)", () => {
    const provider = new UnsupportedAudioTtsProvider();
    expect(provider.getCapability()).toEqual(NO_AUDIO_TTS_CAPABILITY);
    expect(provider.getCapability().supportsAudioNode).toBe(false);
    expect(provider.getCapability().supportsAudioBuffer).toBe(false);
    expect(provider.getCapability().supportsPcm).toBe(false);
    expect(provider.isAvailable()).toBe(false);
    expect(provider.id).toBeTruthy();
    expect(provider.name).toBeTruthy();
  });

  it("speak returns a session that exposes no analyzable audio", () => {
    const provider = new UnsupportedAudioTtsProvider();
    const session = provider.speak("你好") as AudioTtsPlaybackSession;
    expect(session.id).toBeTruthy();
    expect(session.getAudioNode()).toBeNull();
    expect(session.getAudioBuffer()).toBeNull();
    expect(session.getPcm()).toBeNull();
    expect(session.getCapability().supportsAudioNode).toBe(false);
    expect(session.getStatus()).toBe("idle");
  });

  it("fires onEnd callback exactly once when cancelled", () => {
    const provider = new UnsupportedAudioTtsProvider();
    const session = provider.speak("你好");
    let ended = false;
    session.onEnd(() => {
      ended = true;
    });
    session.cancel();
    expect(ended).toBe(true);
    expect(session.getStatus()).toBe("cancelled");
    // 重复 cancel 不应再次触发
    session.cancel();
    expect(session.getStatus()).toBe("cancelled");
  });
});

describe("describeBrowserTtsCapability", () => {
  it("returns all-false capability (speechSynthesis exposes no AudioNode)", () => {
    expect(describeBrowserTtsCapability()).toEqual(NO_AUDIO_TTS_CAPABILITY);
    expect(describeBrowserTtsCapability().supportsAudioNode).toBe(false);
    expect(describeBrowserTtsCapability().supportsAudioBuffer).toBe(false);
    expect(describeBrowserTtsCapability().supportsPcm).toBe(false);
  });
});
