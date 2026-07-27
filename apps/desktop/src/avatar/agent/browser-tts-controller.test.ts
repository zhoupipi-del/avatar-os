import { describe, expect, it, vi } from "vitest";

import {
  BrowserTtsController,
  chooseVoice,
} from "./browser-tts-controller";

class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

function createVoice(
  name: string,
  lang: string,
): SpeechSynthesisVoice {
  return {
    name,
    lang,
    voiceURI: name,
    default: false,
    localService: true,
  };
}

function createSynth(
  voices: SpeechSynthesisVoice[] = [],
): SpeechSynthesis {
  return {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    getVoices: vi.fn(() => voices),
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as SpeechSynthesis;
}

describe("BrowserTtsController", () => {
  it("chooses exact zh-CN voice first", () => {
    const zhTw = createVoice("Chinese TW", "zh-TW");
    const zhCn = createVoice("Chinese CN", "zh-CN");
    const en = createVoice("English", "en-US");

    expect(chooseVoice([en, zhTw, zhCn], "zh-CN")).toBe(zhCn);
  });

  it("falls back to any Chinese voice", () => {
    const zhTw = createVoice("Chinese TW", "zh-TW");
    const en = createVoice("English", "en-US");

    expect(chooseVoice([en, zhTw], "zh-CN")).toBe(zhTw);
  });

  it("falls back to first voice when no Chinese voice exists", () => {
    const en = createVoice("English", "en-US");

    expect(chooseVoice([en], "zh-CN")).toBe(en);
  });

  it("speaks text through speechSynthesis", () => {
    const voice = createVoice("Chinese CN", "zh-CN");
    const synth = createSynth([voice]);

    const controller = new BrowserTtsController({
      speechSynthesis: synth,
      utteranceCtor: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
    });

    controller.speak("你好");

    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);

    const utterance = vi.mocked(synth.speak).mock.calls[0]?.[0] as FakeUtterance;

    expect(utterance.text).toBe("你好");
    expect(utterance.lang).toBe("zh-CN");
    expect(utterance.voice).toBe(voice);
  });

  it("does nothing when speechSynthesis is unavailable", () => {
    const controller = new BrowserTtsController({
      speechSynthesis: null,
      utteranceCtor: null,
    });

    expect(() => controller.speak("你好")).not.toThrow();
    expect(controller.getStatus().available).toBe(false);
  });

  it("cancels speech on dispose", () => {
    const synth = createSynth();

    const controller = new BrowserTtsController({
      speechSynthesis: synth,
      utteranceCtor: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
    });

    controller.dispose();

    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });
});
