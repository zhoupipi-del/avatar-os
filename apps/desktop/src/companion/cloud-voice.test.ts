import { describe, expect, it, vi } from "vitest";
import {
  CloudTtsClient,
  CompanionVoice,
  sanitizeVoiceName,
  uploadVoiceSample,
  type PlayableAudio,
} from "./cloud-voice";
import { CompanionSettingsStore, defaultSettingsFromEnv, isCloneVoiceReady } from "./companion-settings";
import type { BrowserTtsController } from "../avatar/agent/browser-tts-controller";

const CLONE = {
  voiceMode: "clone" as const,
  voiceBaseUrl: "https://api.siliconflow.cn/v1/",
  voiceApiKey: "sk-voice",
  voiceModel: "FunAudioLLM/CosyVoice2-0.5B",
  voiceId: "speech:me:abc",
};

function audioResponse() {
  return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }), { status: 200 });
}

function fakeTts(enabled = true) {
  return {
    speak: vi.fn((_text: string, callbacks?: { onStart?: () => void }) => { callbacks?.onStart?.(); return true; }),
    cancel: vi.fn(),
    getStatus: () => ({ available: true, enabled, speaking: false, pending: false, voiceName: null, lang: "zh-CN" }),
    getVoiceParams: () => ({ rate: 1.2, pitch: 1, volume: 0.6 }),
  } as unknown as BrowserTtsController & { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
}

/** 可控的假 Audio：play() 后手动触发 playing / ended */
function fakeAudioFactory() {
  const created: Array<PlayableAudio & { fire: (t: string) => void; paused: boolean }> = [];
  const factory = (_url: string) => {
    const listeners: Record<string, Array<() => void>> = {};
    const a = {
      volume: 1,
      paused: false,
      play: vi.fn(async () => {}),
      pause: vi.fn(function (this: { paused: boolean }) {
        a.paused = true;
      }),
      addEventListener: (t: string, l: () => void) => {
        (listeners[t] ??= []).push(l);
      },
      fire: (t: string) => (listeners[t] ?? []).forEach((l) => l()),
    };
    created.push(a as never);
    return a as unknown as PlayableAudio;
  };
  return { factory, created };
}

const urls = { createObjectUrl: () => "blob:x", revokeObjectUrl: vi.fn() };

describe("CloudTtsClient", () => {
  it("POSTs OpenAI-compatible /audio/speech with bearer key, voice and clamped speed", async () => {
    const fetchImpl = vi.fn(async () => audioResponse());
    const blob = await new CloudTtsClient({ baseUrl: CLONE.voiceBaseUrl, apiKey: " sk-voice ", model: CLONE.voiceModel, voice: CLONE.voiceId, fetchImpl }).synthesize("你好", { speed: 9 });
    expect(blob.size).toBe(3);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.siliconflow.cn/v1/audio/speech");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-voice");
    expect(JSON.parse(init.body as string)).toEqual({
      model: CLONE.voiceModel,
      input: "你好",
      voice: CLONE.voiceId,
      response_format: "mp3",
      speed: 4,
    });
  });

  it("turns HTTP errors and JSON-as-200 into readable errors", async () => {
    const mk = (res: Response) => new CloudTtsClient({ baseUrl: "https://x/v1", apiKey: "k", model: "m", voice: "v", fetchImpl: async () => res });
    await expect(mk(new Response("bad", { status: 401 })).synthesize("a")).rejects.toThrow("API Key 无效");
    await expect(mk(new Response("x", { status: 402 })).synthesize("a")).rejects.toThrow("余额不足");
    await expect(
      mk(new Response(new Blob(['{"error":"voice not found"}'], { type: "application/json" }))).synthesize("a"),
    ).rejects.toThrow("不是音频");
  });
});

describe("uploadVoiceSample", () => {
  it("sends multipart with model / customName / text / file and returns the uri", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ uri: "speech:companion-voice:1:2" })));
    const uri = await uploadVoiceSample({
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: "sk",
      model: "FunAudioLLM/CosyVoice2-0.5B",
      name: "阿杰的声音",
      transcript: "今天天气真好",
      file: new Blob([new Uint8Array([9])], { type: "audio/mpeg" }),
      fileName: "me.mp3",
      fetchImpl,
    });
    expect(uri).toBe("speech:companion-voice:1:2");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.siliconflow.cn/v1/uploads/audio/voice");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("FunAudioLLM/CosyVoice2-0.5B");
    expect(form.get("customName")).toBe("my-voice");
    expect(form.get("text")).toBe("今天天气真好");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined(); // boundary 由 fetch 生成
  });

  it("validates input before uploading", async () => {
    const base = { baseUrl: "u", model: "m", name: "n", file: new Blob(["a"]), fetchImpl: vi.fn() };
    await expect(uploadVoiceSample({ ...base, apiKey: "", transcript: "x" })).rejects.toThrow("API Key");
    await expect(uploadVoiceSample({ ...base, apiKey: "k", transcript: " " })).rejects.toThrow("逐字");
    expect(base.fetchImpl).not.toHaveBeenCalled();
  });

  it("sanitizes voice names", () => {
    expect(sanitizeVoiceName("Jay's voice 2")).toBe("Jay-s-voice-2");
    expect(sanitizeVoiceName("我的声音")).toBe("my-voice");
  });
});

describe("CompanionVoice", () => {
  it("forwards real system speech events, including cancellation, without early lip movement", async () => {
    const tts = fakeTts();
    let events!: { onStart?: () => void; onEnd?: () => void };
    tts.speak.mockImplementation((_text: string, callbacks: typeof events) => { events = callbacks; return true; });
    const voice = new CompanionVoice({ browserTts: tts, getSettings: () => ({ ...CLONE, voiceMode: "system" }) });
    const onStart = vi.fn();
    const onEnd = vi.fn();
    await voice.speak("你好", { onStart, onEnd });
    expect(onStart).not.toHaveBeenCalled();
    events.onStart?.();
    expect(onStart).toHaveBeenCalledOnce();
    voice.cancel();
    events.onEnd?.();
    events.onStart?.();
    expect(onStart).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("releases failed audio and prevents its old error event from stopping a new sentence", async () => {
    const { factory, created } = fakeAudioFactory();
    const voice = new CompanionVoice({ browserTts: fakeTts(), getSettings: () => CLONE, fetchImpl: async () => audioResponse(), createAudio: factory, ...urls });
    const firstEnd = vi.fn();
    const secondEnd = vi.fn();
    await voice.speak("第一句", { onEnd: firstEnd });
    created[0].fire("playing");
    created[0].fire("error");
    expect(firstEnd).toHaveBeenCalledOnce();
    expect(created[0].paused).toBe(true);
    expect(voice.isAudioPlaying()).toBe(false);
    await voice.speak("第二句", { onEnd: secondEnd });
    created[1].fire("playing");
    created[0].fire("error");
    expect(created[1].paused).toBe(false);
    expect(secondEnd).not.toHaveBeenCalled();
    created[1].fire("ended");
    expect(secondEnd).toHaveBeenCalledOnce();
  });

  it("does not start a voice preview that was cancelled during synthesis", async () => {
    const { factory, created } = fakeAudioFactory();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const voice = new CompanionVoice({ browserTts: fakeTts(), getSettings: () => CLONE, fetchImpl: async () => { await pending; return audioResponse(); }, createAudio: factory, ...urls });
    const preview = voice.preview("试听");
    const rejected = expect(preview).rejects.toMatchObject({ name: "AbortError" });
    voice.cancel();
    release();
    await rejected;
    expect(created).toHaveLength(0);
  });

  it("system mode: speaks via browser TTS and starts lips immediately", async () => {
    const tts = fakeTts();
    const voice = new CompanionVoice({ browserTts: tts, getSettings: () => ({ ...CLONE, voiceMode: "system" }), fetchImpl: vi.fn() });
    const onStart = vi.fn();
    expect(await voice.speak("你好", { onStart })).toBe("system");
    expect(tts.speak).toHaveBeenCalledWith("你好", expect.any(Object));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("clone mode: lips start only when audio is actually playing, and stop when it ends", async () => {
    const tts = fakeTts();
    const { factory, created } = fakeAudioFactory();
    const voice = new CompanionVoice({ browserTts: tts, getSettings: () => CLONE, fetchImpl: async () => audioResponse(), createAudio: factory, ...urls });
    const onStart = vi.fn();
    const onEnd = vi.fn();
    expect(await voice.speak("想你了", { onStart, onEnd })).toBe("clone");
    expect(tts.speak).not.toHaveBeenCalled();
    expect(created[0]!.volume).toBe(0.6); // 复用 ⚙ 音量
    expect(onStart).not.toHaveBeenCalled(); // 还没出声，不张嘴
    created[0]!.fire("playing");
    expect(onStart).toHaveBeenCalledOnce();
    created[0]!.fire("ended");
    expect(onEnd).toHaveBeenCalledOnce();
    expect(urls.revokeObjectUrl).toHaveBeenCalled();
  });

  it("clone failure falls back to system voice so she always hears something", async () => {
    const tts = fakeTts();
    const voice = new CompanionVoice({ browserTts: tts, getSettings: () => CLONE, fetchImpl: async () => new Response("", { status: 402 }) });
    const onStart = vi.fn();
    expect(await voice.speak("早点睡", { onStart })).toBe("clone-fallback");
    expect(tts.speak).toHaveBeenCalledWith("早点睡", expect.any(Object));
    expect(onStart).toHaveBeenCalledOnce();
    expect(voice.getStatus().lastError).toContain("余额不足");
  });

  it("TTS switch off: no sound at all, lips still move", async () => {
    const tts = fakeTts(false);
    const fetchImpl = vi.fn();
    const voice = new CompanionVoice({ browserTts: tts, getSettings: () => CLONE, fetchImpl });
    const onStart = vi.fn();
    expect(await voice.speak("嗯", { onStart })).toBe("muted");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tts.speak).not.toHaveBeenCalled();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("a newer sentence cancels the older one (no overlapping voices)", async () => {
    const tts = fakeTts();
    const { factory, created } = fakeAudioFactory();
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) await slow;
      return audioResponse();
    });
    const voice = new CompanionVoice({ browserTts: tts, getSettings: () => CLONE, fetchImpl, createAudio: factory, ...urls });
    const firstStart = vi.fn();
    const first = voice.speak("第一句", { onStart: firstStart });
    await voice.speak("第二句");
    release();
    await first;
    expect(created).toHaveLength(1); // 第一句的音频从未创建
    expect(firstStart).not.toHaveBeenCalled();
  });
});

describe("voice settings", () => {
  it("env: key + voice id → clone mode with SiliconFlow defaults", () => {
    const d = defaultSettingsFromEnv({ VITE_VOICE_API_KEY: "sk", VITE_VOICE_ID: "speech:a:b" });
    expect(d).toMatchObject({
      voiceMode: "clone",
      voiceBaseUrl: "https://api.siliconflow.cn/v1",
      voiceModel: "FunAudioLLM/CosyVoice2-0.5B",
    });
    expect(isCloneVoiceReady(d)).toBe(true);
    expect(defaultSettingsFromEnv({}).voiceMode).toBe("system");
    expect(defaultSettingsFromEnv({ VITE_VOICE_MODE: "system", VITE_VOICE_API_KEY: "sk", VITE_VOICE_ID: "x" }).voiceMode).toBe("system");
  });

  it("clone mode without a voice id is not ready (falls back to system)", () => {
    expect(isCloneVoiceReady({ ...CLONE, voiceId: "" })).toBe(false);
  });

  it("locked builds ignore local voice overrides", () => {
    const defaults = defaultSettingsFromEnv({ VITE_VOICE_API_KEY: "sk", VITE_VOICE_ID: "speech:packaged" });
    const storage = { load: () => ({ voiceId: "speech:tampered", voiceMode: "system" as const }), save: () => {} };
    expect(new CompanionSettingsStore(defaults, storage, true).get()).toMatchObject({ voiceId: "speech:packaged", voiceMode: "clone" });
    expect(new CompanionSettingsStore(defaults, storage, false).get()).toMatchObject({ voiceId: "speech:tampered", voiceMode: "system" });
  });
});

describe("voice sample file types", () => {
  it("accepts mp3/wav/opus/pcm and rejects phone m4a/aac", async () => {
    const { isSupportedVoiceFile } = await import("./CompanionSettingsPanel");
    expect(["a.mp3", "B.WAV", "c.opus", "d.pcm"].every(isSupportedVoiceFile)).toBe(true);
    expect(["录音.m4a", "x.aac", "y.mp4"].some(isSupportedVoiceFile)).toBe(false);
  });
});
