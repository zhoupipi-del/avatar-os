/**
 * Day14A — Kokoro Provider Minimal Spike
 *
 * 目标：证明 kokoro 输出能转换为 PCM / AudioBuffer / WAV bytes，并接 Day13C 的 formant pipeline。
 *
 *   Kokoro package / model
 *     -> synthesize text
 *     -> PCM / AudioBuffer / WAV bytes
 *     -> AudioTtsProvider session
 *     -> Local PCM / Formant pipeline
 *     -> aa / ih / ou / ee / oh result
 *
 * 与 Day13C（合成 PCM fixture）的区别：本模块把"真实 kokoro 合成"作为可选后端，
 * 用动态 import 探测 "kokoro-js"（字符串 specifier，tsc / vite 不静态解析，避免未安装时报错）。
 *
 * 不接产品 runtime、不让 VOID 嘴动、不创建音频对象、不接 edge / piper。
 *
 * 红线（不做的）：
 * - 不创建音频上下文 / 不创建音频节点 / 不与任何音频对象连接
 * - 不改既有产品语音控制器 / 皮肤组件 / 口型面板
 * - 不写 expression / 不驱动口型
 * - 不让 VOID 嘴真实动起来
 *
 * graceful 策略（符合 Day14A 降级条款）：
 * - 本 spike 默认不把 kokoro-js 写入 dependencies（避免 lockfile 污染与模型联网下载硬失败）。
 * - 包可用时走真实合成路径（完整调用链已实现）；模型 / 网络不可达时优雅降级。
 * - 包不存在（本机默认）时，isAvailable() 返回 false，speak() 返回不可用的 session，不抛错。
 */

import {
  type AudioTtsProvider,
  type AudioTtsCapability,
  type AudioTtsPlaybackSession,
  type AudioTtsSessionStatus,
  type AudioTtsSpeakOptions,
  NO_AUDIO_TTS_CAPABILITY,
} from "./audio-tts-provider";
import { type AudioSpectrumSource, createSilentSpectrumSource } from "./audio-spectrum-source";
import { PcmSpectrumSource } from "./pcm-spectrum-source";

/** 候选包 specifier（字符串常量，动态 import 探测用，未安装时返回 null）。 */
const KOKORO_SPECIFIER = "kokoro-js";

/** 若 kokoro 可用，声明的能力：能提供 PCM + 频谱源，不暴露 AudioNode / AudioBuffer。 */
const KOKORO_CAPABILITY: AudioTtsCapability = Object.freeze({
  supportsAudioNode: false,
  supportsAudioBuffer: false,
  supportsPcm: true,
  supportsSpectrumSource: true,
});

/** 探测用的默认模型与音色（仅用于真实合成路径，未安装时不会触发）。 */
const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0";
const KOKORO_DEFAULT_VOICE = "af_heart";

let cachedModule: unknown = null;
let moduleProbeDone = false;

/**
 * 动态探测 kokoro-js 是否可加载。
 * 用变量 specifier（KOKORO_SPECIFIER as string），tsc 不解析模块、vite 不静态打包，
 * 未安装时返回 null 而非构建/类型错误。
 */
async function loadKokoroModule(): Promise<Record<string, any> | null> {
  if (moduleProbeDone) return cachedModule as Record<string, any> | null;
  moduleProbeDone = true;
  try {
    const mod = await import(/* @vite-ignore */ KOKORO_SPECIFIER as string);
    cachedModule = (mod && (mod as Record<string, any>).default ? (mod as any).default : mod) ?? null;
  } catch {
    cachedModule = null;
  }
  return cachedModule as Record<string, any> | null;
}

/** 一次 kokoro 播放会话：speak 同步返回，PCM 经异步 load() 填充（spike 扩展点，非接口要求）。 */
export class KokoroPlaybackSession implements AudioTtsPlaybackSession {
  readonly id: string;
  readonly text: string;
  private status: AudioTtsSessionStatus = "idle";
  private endCbs: Array<() => void> = [];
  private pcmData: { readonly sampleRate: number; readonly channels: ReadonlyArray<Float32Array> } | null = null;
  private spectrumSource: AudioSpectrumSource | null = null;
  private readonly capability: AudioTtsCapability;

  constructor(opts: { text: string; capability: AudioTtsCapability }) {
    this.id = `kokoro-${Math.random().toString(36).slice(2, 10)}`;
    this.text = opts.text ?? "";
    this.capability = opts.capability;
  }

  getCapability(): AudioTtsCapability {
    return this.capability;
  }

  getStatus(): AudioTtsSessionStatus {
    return this.status;
  }

  getAudioNode(): AudioNode | null {
    return null;
  }

  getAudioBuffer(): AudioBuffer | null {
    return null;
  }

  getPcm(): { readonly sampleRate: number; readonly channels: ReadonlyArray<Float32Array> } | null {
    return this.pcmData;
  }

  /** 本会话携带的频谱源（加载 PCM 后才有；否则返回静音源）。 */
  getSpectrumSource(): AudioSpectrumSource {
    return this.spectrumSource ?? createSilentSpectrumSource();
  }

  /**
   * spike 便捷方法（非接口要求）：异步合成 PCM + 构建频谱源。
   * 真实路径：import kokoro-js -> KokoroTTS.from_pretrained -> generate -> audio.audio (Float32Array)。
   * 包未装 / 模型下载失败 / 网络不可达 时静默降级为 ended（无 PCM），不抛错。
   */
  async load(): Promise<void> {
    if (this.status !== "idle") return;
    const mod = await loadKokoroModule();
    const KokoroTTS = mod && (mod.KokoroTTS ?? (mod as any).default?.KokoroTTS);
    if (!KokoroTTS) {
      this.status = "ended";
      this.fireEnd();
      return;
    }
    try {
      const model = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype: "q8" });
      const audio = await model.generate(this.text || " ", { voice: KOKORO_DEFAULT_VOICE });
      const pcm = audio && (audio as any).audio;
      const sr = (audio && (audio as any).sampling_rate) || 24000;
      if (pcm instanceof Float32Array && pcm.length > 0) {
        this.pcmData = { sampleRate: sr, channels: [pcm] as ReadonlyArray<Float32Array> };
        this.spectrumSource = new PcmSpectrumSource({ sampleRate: sr, channelData: pcm });
      }
      this.status = "ended";
    } catch {
      this.status = "ended";
    }
    this.fireEnd();
  }

  cancel(): void {
    if (this.status === "ended" || this.status === "cancelled") return;
    this.status = "cancelled";
    this.fireEnd();
  }

  onEnd(cb: () => void): void {
    this.endCbs.push(cb);
  }

  private fireEnd(): void {
    const cbs = this.endCbs;
    this.endCbs = [];
    for (const cb of cbs) cb();
  }
}

/**
 * Kokoro provider spike：实现 Day11A 的 AudioTtsProvider。
 * 真实 kokoro 后端为可选（动态探测），证明链路可接但不硬接。
 */
export class KokoroProviderSpike implements AudioTtsProvider {
  readonly id = "kokoro-provider-spike";
  readonly name = "Kokoro Provider Spike (dynamic-import probe, no product runtime)";
  private readonly sampleRate: number;
  private available = false;
  private activeSession: KokoroPlaybackSession | null = null;

  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate && opts.sampleRate > 0 ? opts.sampleRate : 24000;
    // 启动异步探测（不 await，避免阻塞构造）；结果通过 isAvailable / 后续 getCapability 体现。
    void this.bootstrap();
  }

  /** 异步探测 kokoro-js 是否本机可加载，并更新 available 标志。 */
  private async bootstrap(): Promise<void> {
    const mod = await loadKokoroModule();
    this.available = !!(mod && (mod.KokoroTTS || (mod as any).default?.KokoroTTS));
  }

  /** 同步返回当前探测到的可用状态（构造后首次探测完成前为 false）。 */
  isAvailable(): boolean {
    return this.available;
  }

  getCapability(): AudioTtsCapability {
    return this.available ? KOKORO_CAPABILITY : NO_AUDIO_TTS_CAPABILITY;
  }

  /** 同步返回会话；真实合成经 session.load() 异步触发（包可用时）。 */
  speak(text: string, _options?: AudioTtsSpeakOptions): KokoroPlaybackSession {
    const session = new KokoroPlaybackSession({
      text,
      capability: this.getCapability(),
    });
    this.activeSession = session;
    return session;
  }

  cancel(): void {
    this.activeSession?.cancel();
    this.activeSession = null;
  }
}

/** 便利工厂：构造默认参数的 kokoro provider spike。 */
export function createKokoroProviderSpike(opts?: { sampleRate?: number }): KokoroProviderSpike {
  return new KokoroProviderSpike(opts);
}

/** 探测 kokoro-js 是否本机可加载（供测试 graceful skip 用）。 */
export async function isKokoroInstalled(): Promise<boolean> {
  const mod = await loadKokoroModule();
  return !!(mod && (mod.KokoroTTS || (mod as any).default?.KokoroTTS));
}
