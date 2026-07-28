/**
 * Day13A — Audio Fixture TTS Provider
 *
 * 把一个"可测试的文件/fixture 型音频提供方"落地，串起 Day11A provider 接口、
 * Day11C 频谱源适配层、Day12 formant probe，形成一条**测试闭环**：
 *
 *   AudioFixtureTtsProvider.speak(text)
 *     → AudioFixturePlaybackSession（内含频谱源）
 *     → CyclingFrequencySpectrumSource（静态/循环帧，模拟可分析音频）
 *     → FormantVisemeRuntimeProbe
 *     → aa / ih / ou / ee / oh
 *
 * 本阶段不接真实 TTS、不接产品 runtime、不驱动嘴：
 * - 频谱来自预先构造的元音帧（fixture），不是真实声音、不解码任何媒体。
 * - 不实例化任何音频上下文 / 媒体元素 / 缓冲源；全部是普通数据帧。
 * - 不写表情、不接 VRM / 皮肤组件 / 语音控制器 / 口型面板。
 * - 真实 TTS 接线推迟到后续真实 TTS 评估阶段（待 BOSS 拍板）。
 *
 * 红线（不做的）：不写音频上下文 / 媒体元素源 / 缓冲源实现、不引入真实 TTS 依赖、
 * 不驱动表情、不修改产品语音控制器 / 皮肤组件 / 口型面板。
 */

import {
  type AudioTtsProvider,
  type AudioTtsCapability,
  type AudioTtsPlaybackSession,
  type AudioTtsSessionStatus,
  type AudioTtsSpeakOptions,
} from "./audio-tts-provider";
import { CyclingFrequencySpectrumSource, type AudioSpectrumSource } from "./audio-spectrum-source";
import type { MouthShape } from "./formant-viseme-analyzer";

/** fixture provider 的能力：支持频谱源，不支持真实音频节点/缓冲/PCM。 */
const FIXTURE_CAPABILITY: AudioTtsCapability = Object.freeze({
  supportsAudioNode: false,
  supportsAudioBuffer: false,
  supportsPcm: false,
  supportsSpectrumSource: true,
});

const VOWEL_SHAPES: readonly MouthShape[] = ["aa", "ih", "ou", "ee", "oh"];

/**
 * 构造一组"代表帧"，每帧对应一个元音，模拟可分析音频的逐帧频谱。
 * 每帧在元音三角对应频段放一个峰值，并在人声频段铺一层能量底（> noiseGate），
 * 保证 analyzer 判定为 active 且分类落入目标元音。
 */
function buildVowelFrames(sampleRate: number, binCount: number): Uint8Array[] {
  const nyquist = sampleRate / 2;
  const binOf = (freq: number): number =>
    Math.max(0, Math.min(binCount - 1, Math.round((freq / nyquist) * binCount)));

  // 人声频段能量底（200~4000Hz），确保平均能量高于 analyzer 默认 noiseGate(15)。
  const floorStart = binOf(200);
  const floorEnd = binOf(4000);
  const baseFrame = (): Uint8Array => {
    const d = new Uint8Array(binCount);
    for (let i = floorStart; i <= floorEnd; i++) d[i] = 40;
    return d;
  };

  const withPeaks = (f1Freq: number, f2Freq: number): Uint8Array => {
    const d = baseFrame();
    d[binOf(f1Freq)] = 220;
    d[binOf(f2Freq)] = 200;
    return d;
  };

  // 帧顺序对应 VOWEL_SHAPES：aa / ih / ou / ee / oh
  return [
    withPeaks(700, 2000), // aa：F1 高
    withPeaks(300, 2200), // ih：F1 低 + F2 高
    withPeaks(300, 1100), // ou：F1 低 + F2 低
    withPeaks(450, 2200), // ee：F1 居中 + F2 高
    withPeaks(450, 1100), // oh：F1 居中 + F2 低
  ];
}

/** 一次 fixture 播放会话：实现 Day11A 的 AudioTtsPlaybackSession，并暴露频谱源。 */
export class AudioFixturePlaybackSession implements AudioTtsPlaybackSession {
  readonly id: string;
  readonly text: string;
  readonly durationMs: number;
  readonly startedAt: number;
  private status: AudioTtsSessionStatus = "playing";
  private endCbs: Array<() => void> = [];
  private readonly spectrumSource: AudioSpectrumSource;
  private readonly capability: AudioTtsCapability;

  constructor(opts: {
    text: string;
    durationMs: number;
    spectrumSource: AudioSpectrumSource;
    capability: AudioTtsCapability;
  }) {
    this.id = `fixture-${Math.random().toString(36).slice(2, 10)}`;
    this.text = opts.text;
    this.durationMs = opts.durationMs;
    this.startedAt = Date.now();
    this.spectrumSource = opts.spectrumSource;
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
    return null;
  }

  /** 本会话携带的频谱源（fixture 循环帧），供上层探针拉取频域数据。 */
  getSpectrumSource(): AudioSpectrumSource {
    return this.spectrumSource;
  }

  cancel(): void {
    if (this.status === "ended" || this.status === "cancelled") {
      return;
    }
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
 * fixture 型音频 TTS 提供方：用循环频谱帧模拟"可分析音频播放"。
 * 实现 Day11A 的 AudioTtsProvider，但 speakspectrum 来自 fixture，不接任何真实引擎。
 */
export class AudioFixtureTtsProvider implements AudioTtsProvider {
  readonly id = "audio-fixture-tts";
  readonly name = "Audio Fixture TTS (cyclic spectrum source, no real audio)";
  private readonly sampleRate: number;
  private readonly binCount: number;
  private readonly capability: AudioTtsCapability = FIXTURE_CAPABILITY;
  private activeSession: AudioFixturePlaybackSession | null = null;

  constructor(opts?: { sampleRate?: number; binCount?: number }) {
    this.sampleRate = Number.isFinite(opts?.sampleRate) && (opts?.sampleRate ?? 0) > 0 ? opts!.sampleRate! : 44100;
    this.binCount = Number.isFinite(opts?.binCount) && (opts?.binCount ?? 0) > 0 ? Math.floor(opts!.binCount!) : 512;
  }

  isAvailable(): boolean {
    return true;
  }

  getCapability(): AudioTtsCapability {
    return this.capability;
  }

  /** 返回具体会话类型，便于上层直接取频谱源。 */
  speak(text: string, _options?: AudioTtsSpeakOptions): AudioFixturePlaybackSession {
    const safeText = text ?? "";
    const frames = buildVowelFrames(this.sampleRate, this.binCount);
    const spectrumSource = new CyclingFrequencySpectrumSource(frames, this.sampleRate);
    const durationMs = Math.max(300, safeText.length * 100);
    const session = new AudioFixturePlaybackSession({
      text: safeText,
      durationMs,
      spectrumSource,
      capability: this.capability,
    });
    this.activeSession = session;
    return session;
  }

  cancel(): void {
    this.activeSession?.cancel();
    this.activeSession = null;
  }
}

/** 便利工厂：构造一个默认参数的 fixture provider。 */
export function createAudioFixtureTtsProvider(opts?: {
  sampleRate?: number;
  binCount?: number;
}): AudioFixtureTtsProvider {
  return new AudioFixtureTtsProvider(opts);
}

export { VOWEL_SHAPES };
