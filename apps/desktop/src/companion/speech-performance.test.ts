import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechPerformance } from "./speech-performance";
import type { SpeakCallbacks, VoiceSource } from "./cloud-voice";

function setup(source: VoiceSource = "clone") {
  const calls: SpeakCallbacks[] = [];
  const onPrepare = vi.fn();
  const onStart = vi.fn();
  const onEnd = vi.fn();
  const voice = {
    cancel: vi.fn(),
    speak: vi.fn(async (_text: string, callbacks: SpeakCallbacks) => {
      calls.push(callbacks);
      return source;
    }),
  };
  const performance = new SpeechPerformance({
    voice,
    onPrepare,
    onStart,
    onEnd,
    silentDurationMs: () => 1000,
  });
  return { calls, onPrepare, onStart, onEnd, voice, performance };
}

afterEach(() => vi.useRealTimers());

describe("SpeechPerformance", () => {
  it("waits for playback before applying the reply's emotion, motion and lips", async () => {
    const { performance, calls, onPrepare, onStart, onEnd } = setup();
    const applyReply = vi.fn();
    performance.speak("你好", applyReply);
    expect(performance.isActive()).toBe(true);
    expect(onPrepare).toHaveBeenCalledOnce();
    expect(applyReply).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    calls[0].onStart?.();
    calls[0].onStart?.();
    expect(applyReply).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledWith("你好");
    calls[0].onEnd?.();
    calls[0].onEnd?.();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(performance.isActive()).toBe(false);
  });

  it("rejects old playback events while the new utterance owns the body", () => {
    const { performance, calls, onStart, onEnd } = setup();
    const oldReply = vi.fn();
    performance.speak("旧回复", oldReply);
    performance.speak("新回复");
    calls[0].onStart?.();
    calls[0].onEnd?.();
    expect(oldReply).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
    calls[1].onStart?.();
    expect(onStart).toHaveBeenCalledWith("新回复");
    performance.cancel();
    expect(performance.isActive()).toBe(false);
    calls[1].onEnd?.();
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it("bounds silent performances and cancels their old timers", async () => {
    vi.useFakeTimers();
    const { performance, calls, onEnd } = setup("muted");
    performance.speak("第一句");
    calls[0].onStart?.();
    await Promise.resolve();
    vi.advanceTimersByTime(800);
    performance.speak("第二句");
    calls[1].onStart?.();
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    expect(onEnd).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(800);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it("releases body ownership when playback setup rejects", async () => {
    const onEnd = vi.fn();
    const performance = new SpeechPerformance({
      voice: {
        speak: async () => {
          throw new Error("audio unavailable");
        },
        cancel: vi.fn(),
      },
      onPrepare: vi.fn(),
      onStart: vi.fn(),
      onEnd,
      silentDurationMs: () => 1000,
    });
    performance.speak("你好");
    await Promise.resolve();
    await Promise.resolve();
    expect(onEnd).toHaveBeenCalledOnce();
  });
});
