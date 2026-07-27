import { describe, expect, it, vi } from "vitest";

import {
  applyVoiceControlState,
  clampVoiceControlState,
  DEFAULT_VOICE_CONTROL_STATE,
} from "./voice-control-state";
import type {
  BrowserTtsController,
  BrowserTtsStatus,
} from "./browser-tts-controller";

function createMockTts(): BrowserTtsController {
  const status: BrowserTtsStatus = {
    available: true,
    enabled: true,
    speaking: false,
    pending: false,
    voiceName: "Chinese CN",
    lang: "zh-CN",
  };
  return {
    setEnabled: vi.fn(),
    setOptions: vi.fn(),
    cancel: vi.fn(),
    getStatus: vi.fn(() => status),
    speak: vi.fn(),
    dispose: vi.fn(),
  } as unknown as BrowserTtsController;
}

describe("voice-control-state", () => {
  it("default state is neutral", () => {
    expect(DEFAULT_VOICE_CONTROL_STATE).toEqual({
      enabled: true,
      rate: 1,
      pitch: 1,
      volume: 1,
    });
  });

  it("applyVoiceControlState pushes state into controller", () => {
    const tts = createMockTts();
    applyVoiceControlState(
      { enabled: false, rate: 1.5, pitch: 0.8, volume: 0.4 },
      tts,
    );
    expect(tts.setEnabled).toHaveBeenCalledWith(false);
    expect(tts.setOptions).toHaveBeenCalledWith({
      rate: 1.5,
      pitch: 0.8,
      volume: 0.4,
    });
  });

  it("clamps rate/pitch/volume into valid ranges", () => {
    const clamped = clampVoiceControlState({
      enabled: true,
      rate: 99,
      pitch: -5,
      volume: 7,
    });
    expect(clamped.rate).toBeLessThanOrEqual(10);
    expect(clamped.rate).toBeGreaterThanOrEqual(0.1);
    expect(clamped.pitch).toBeGreaterThanOrEqual(0);
    expect(clamped.pitch).toBeLessThanOrEqual(2);
    expect(clamped.volume).toBeGreaterThanOrEqual(0);
    expect(clamped.volume).toBeLessThanOrEqual(1);
  });

  it("keeps enabled boolean untouched by clamp", () => {
    const clamped = clampVoiceControlState({
      enabled: false,
      rate: 1,
      pitch: 1,
      volume: 1,
    });
    expect(clamped.enabled).toBe(false);
  });
});
