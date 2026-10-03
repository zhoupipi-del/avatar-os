/**
 * cloud-voice —— 用「你的声音」朗读
 *
 * 1. CloudTtsClient：OpenAI 兼容 POST {baseUrl}/audio/speech（默认硅基流动 CosyVoice2），返回音频 Blob。
 * 2. uploadVoiceSample：上传 8–10 秒单人参考音频 + 对应文字，换回克隆声音 uri（speech:...）。
 * 3. CompanionVoice：朗读门面。配置了克隆声音就云端合成，否则 / 失败时退回系统语音（BrowserTts）。
 *    嘴型在音频真正开始播放时才启动（onStart），播完收嘴（onEnd）——云端合成有网络延迟，
 *    若照旧"先动嘴"会出现张嘴 1–2 秒后才出声。
 *
 * 只依赖注入的 fetch / Audio 工厂，Node 测试可完整覆盖。
 */

import type { BrowserTtsController } from "../avatar/agent/browser-tts-controller";
import { isCloneVoiceReady, type CompanionSettings } from "./companion-settings";

type VoiceConfig = Pick<CompanionSettings, "voiceMode" | "voiceBaseUrl" | "voiceApiKey" | "voiceModel" | "voiceId">;

export class VoiceRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "VoiceRequestError";
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.trim().replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** HTTP 错误 → 给人看的中文提示 */
export function describeVoiceHttpError(status: number, body: string): string {
  const detail = body.replace(/\s+/g, " ").trim().slice(0, 120);
  switch (status) {
    case 400:
      return `请求被拒绝（HTTP 400）：${detail || "检查模型名 / 音色是否正确"}`;
    case 401:
    case 403:
      return `语音 API Key 无效或无权限（HTTP ${status}）`;
    case 402:
      return "语音服务余额不足（HTTP 402）";
    case 404:
      return "语音接口地址或模型不存在（HTTP 404）";
    case 429:
      return "请求太频繁或额度用完（HTTP 429）";
    default:
      return `语音服务出错（HTTP ${status}）${detail ? `：${detail}` : ""}`;
  }
}

export interface CloudTtsClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly voice: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class CloudTtsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: CloudTtsClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async synthesize(text: string, opts: { speed?: number; signal?: AbortSignal } = {}): Promise<Blob> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), this.timeoutMs);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onOuterAbort);
    try {
      const res = await this.fetchImpl(joinUrl(this.options.baseUrl, "audio/speech"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: this.options.model.trim(),
          input: text,
          voice: this.options.voice.trim(),
          response_format: "mp3",
          speed: clamp(opts.speed ?? 1, 0.25, 4),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new VoiceRequestError(describeVoiceHttpError(res.status, await safeText(res)), res.status);
      }
      const blob = await res.blob();
      if (blob.size === 0) throw new VoiceRequestError("语音服务返回了空音频");
      // 有的服务把错误以 200 + JSON 返回
      if (/json/i.test(blob.type)) {
        throw new VoiceRequestError(`语音服务返回的不是音频：${(await blob.text()).slice(0, 120)}`);
      }
      return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: "audio/mpeg" });
    } finally {
      globalThis.clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
    }
  }
}

export interface UploadVoiceSampleOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** 音色名（只保留字母数字 - _） */
  readonly name: string;
  /** 参考音频里说的话，逐字 */
  readonly transcript: string;
  readonly file: Blob;
  readonly fileName?: string;
  readonly fetchImpl?: typeof fetch;
}

/** 音色名只允许字母、数字、- 和 _；中文名转成默认名，避免服务端拒绝 */
export function sanitizeVoiceName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return cleaned || "my-voice";
}

/** 上传参考音频（multipart），返回克隆声音 uri（speech:...） */
export async function uploadVoiceSample(opts: UploadVoiceSampleOptions): Promise<string> {
  if (!opts.apiKey.trim()) throw new VoiceRequestError("请先填写语音 API Key");
  if (!opts.transcript.trim()) throw new VoiceRequestError("请填写样本里说的话（要和录音逐字一致）");
  if (opts.file.size > 10 * 1024 * 1024) throw new VoiceRequestError("音频文件太大，请截取 8–10 秒（小于 30 秒）");

  const form = new FormData();
  form.append("model", opts.model.trim());
  form.append("customName", sanitizeVoiceName(opts.name));
  form.append("text", opts.transcript.trim());
  form.append("file", opts.file, opts.fileName ?? "sample.mp3");

  const fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const res = await fetchImpl(joinUrl(opts.baseUrl, "uploads/audio/voice"), {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey.trim()}` },
    body: form,
  });
  const body = await safeText(res);
  if (!res.ok) throw new VoiceRequestError(describeVoiceHttpError(res.status, body), res.status);
  let uri: unknown;
  try {
    uri = (JSON.parse(body) as { uri?: unknown }).uri;
  } catch {
    uri = undefined;
  }
  if (typeof uri !== "string" || !uri.trim()) {
    throw new VoiceRequestError(`上传成功但没拿到音色 uri：${body.slice(0, 120)}`);
  }
  return uri.trim();
}

/** 最小音频播放接口（浏览器 HTMLAudioElement 满足它；测试里可替换） */
export interface PlayableAudio {
  volume: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "playing" | "ended" | "error", listener: () => void, options?: { once?: boolean }): void;
}

export interface CompanionVoiceDeps {
  readonly browserTts: BrowserTtsController;
  readonly getSettings: () => VoiceConfig;
  readonly fetchImpl?: typeof fetch;
  readonly createAudio?: (url: string) => PlayableAudio;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

export interface SpeakCallbacks {
  /** 声音真正开始时（启动嘴型） */
  readonly onStart?: () => void;
  /** 云端音频播放结束（收嘴）。系统语音不回调——沿用原有文本节奏收嘴 */
  readonly onEnd?: () => void;
}

export type VoiceSource = "system" | "clone" | "clone-fallback" | "muted";

export interface CompanionVoiceStatus {
  readonly lastSource: VoiceSource | null;
  readonly lastError: string | null;
}

export class CompanionVoice {
  private seq = 0;
  private abort: AbortController | null = null;
  private audio: PlayableAudio | null = null;
  private url: string | null = null;
  private status: CompanionVoiceStatus = { lastSource: null, lastError: null };

  constructor(private readonly deps: CompanionVoiceDeps) {}

  getStatus(): CompanionVoiceStatus {
    return this.status;
  }

  /** 朗读一句话。总是 resolve，不抛错；失败时退回系统语音。 */
  async speak(text: string, cb: SpeakCallbacks = {}): Promise<VoiceSource> {
    const content = text.trim();
    this.cancel();
    const mySeq = this.seq;
    const tts = this.deps.browserTts;

    // TTS 总开关关闭：不出声，嘴型照常（与原行为一致）
    if (!content || !tts.getStatus().enabled) {
      cb.onStart?.();
      return this.setSource("muted", null);
    }

    const settings = this.deps.getSettings();
    if (!isCloneVoiceReady(settings)) {
      tts.speak(content);
      cb.onStart?.();
      return this.setSource("system", null);
    }

    const params = tts.getVoiceParams();
    const abort = new AbortController();
    this.abort = abort;
    try {
      const client = new CloudTtsClient({
        baseUrl: settings.voiceBaseUrl,
        apiKey: settings.voiceApiKey,
        model: settings.voiceModel,
        voice: settings.voiceId,
        fetchImpl: this.deps.fetchImpl,
      });
      const blob = await client.synthesize(content, { speed: params.rate, signal: abort.signal });
      if (mySeq !== this.seq) return this.status.lastSource ?? "clone";

      const url = (this.deps.createObjectUrl ?? ((b) => URL.createObjectURL(b)))(blob);
      const audio = (this.deps.createAudio ?? ((u) => new Audio(u) as unknown as PlayableAudio))(url);
      audio.volume = clamp(params.volume, 0, 1);
      this.audio = audio;
      this.url = url;

      let started = false;
      audio.addEventListener("playing", () => {
        if (started || mySeq !== this.seq) return;
        started = true;
        cb.onStart?.();
      });
      audio.addEventListener("ended", () => {
        if (mySeq !== this.seq) return;
        this.releaseAudio();
        cb.onEnd?.();
      }, { once: true });

      await audio.play();
      return this.setSource("clone", null);
    } catch (error) {
      if (mySeq !== this.seq) return this.status.lastSource ?? "clone";
      this.releaseAudio();
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[CompanionVoice] clone voice failed, falling back to system voice:", message);
      tts.speak(content);
      cb.onStart?.();
      return this.setSource("clone-fallback", message);
    }
  }

  /** 试听：直接用当前设置合成一句，失败时抛出可读错误（设置面板用） */
  async preview(text: string): Promise<void> {
    const settings = this.deps.getSettings();
    if (!isCloneVoiceReady({ ...settings, voiceMode: "clone" })) {
      throw new VoiceRequestError("请先填写语音 API Key 和音色");
    }
    this.cancel();
    const blob = await new CloudTtsClient({
      baseUrl: settings.voiceBaseUrl,
      apiKey: settings.voiceApiKey,
      model: settings.voiceModel,
      voice: settings.voiceId,
      fetchImpl: this.deps.fetchImpl,
    }).synthesize(text, { speed: this.deps.browserTts.getVoiceParams().rate });
    const url = (this.deps.createObjectUrl ?? ((b) => URL.createObjectURL(b)))(blob);
    const audio = (this.deps.createAudio ?? ((u) => new Audio(u) as unknown as PlayableAudio))(url);
    audio.volume = clamp(this.deps.browserTts.getVoiceParams().volume, 0, 1);
    this.audio = audio;
    this.url = url;
    audio.addEventListener("ended", () => this.releaseAudio(), { once: true });
    await audio.play();
  }

  cancel(): void {
    this.seq += 1;
    this.abort?.abort();
    this.abort = null;
    this.releaseAudio();
    this.deps.browserTts.cancel();
  }

  dispose(): void {
    this.cancel();
  }

  private releaseAudio(): void {
    if (this.audio) {
      try {
        this.audio.pause();
      } catch {
        // ignore
      }
      this.audio = null;
    }
    if (this.url) {
      (this.deps.revokeObjectUrl ?? ((u) => URL.revokeObjectURL(u)))(this.url);
      this.url = null;
    }
  }

  private setSource(source: VoiceSource, error: string | null): VoiceSource {
    this.status = { lastSource: source, lastError: error };
    return source;
  }
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
