/**
 * Day13C — Local PCM Fixture TTS Provider
 *
 * 用合成元音 PCM 模拟"可分析音频播放"，串起 Day11A provider 接口、
 * Day13C PcmSpectrumSource、Day11C 频谱探针，形成一条**类真实音频测试闭环**：
 *
 *   LocalPcmFixtureTtsProvider.speak(text)
 *     -> LocalPcmFixturePlaybackSession（内含 PCM + 频谱源）
 *     -> PcmSpectrumSource（PCM -> Hann -> FFT -> 频域幅度）
 *     -> FormantVisemeRuntimeProbe
 *     -> aa / ih / ou / ee / oh
 *
 * 与 Day13A 的区别：Day13A 用预构造频谱帧（CyclingFrequencySpectrumSource）模拟音频，
 * 本模块从**时域 PCM 采样**出发，经过真实 FFT 变换得到频谱，更接近真实音频处理链路。
 *
 * 本阶段不接真实 TTS、不接产品 runtime、不驱动嘴：
 * - PCM 来自 buildSyntheticVowelPcm 数学合成，不是真实声音、不解码任何媒体。
 * - 不实例化任何音频上下文 / 媒体元素 / 缓冲源；全部是普通数据。
 * - 不写表情、不接 VRM / 皮肤组件 / 语音控制器 / 口型面板。
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
import type { AudioSpectrumSource } from "./audio-spectrum-source";
import { PcmSpectrumSource, buildSyntheticVowelPcm } from "./pcm-spectrum-source";
import type { MouthShape } from "./formant-viseme-analyzer";

/** PCM fixture provider 的能力：支持 PCM + 频谱源，不支持真实音频节点/缓冲。 */
const PCM_FIXTURE_CAPABILITY: AudioTtsCapability = Object.freeze({
  supportsAudioNode: false,
  supportsAudioBuffer: false,
  supportsPcm: true,
  supportsSpectrumSource: true,
});

/** 五个元音的共振峰参数，用于拼接多段合成 PCM。 */
const VOWEL_PARAMS: ReadonlyArray<{ shape: MouthShape; f1: number; f2: number }> = [
  { shape: "aa", f1: 700, f2: 2000 },
  { shape: "ih", f1: 300, f2: 2200 },
  { shape: "ou", f1: 300, f2: 1100 },
  { shape: "ee", f1: 450, f2: 2200 },
  { shape: "oh", f1: 450, f2: 1100 },
];

/**
 * 拼接五段元音 PCM，模拟"依次发出 aa/ih/ou/ee/oh"的语音段。
 * 每段时长 = max(100ms, durationMs / 5)。
 */
function buildMultiVowelPcm(sampleRate: number, durationMs: number): Float32Array {
  const segmentMs = Math.max(100, durationMs / VOWEL_PARAMS.length);
  const segments = VOWEL_PARAMS.map(({ f1, f2 }) =>
    buildSyntheticVowelPcm(sampleRate, segmentMs, f1, f2),
  );
  const totalLength = segments.reduce((sum, s) => sum + s.length, 0);
  const pcm = new Float32Array(totalLength);
  let offset = 0;
  for (const seg of segments) {
    pcm.set(seg, offset);
    offset += seg.length;
  }
  return pcm;
}

/** 一次 PCM fixture 播放会话：实现 Day11A 的 AudioTtsPlaybackSession，并暴露 PCM 与频谱源。 */
export class LocalPcmFixturePlaybackSession implements AudioTtsPlaybackSession {
  readonly id: string;
  readonly text: string;
  readonly durationMs: number;
  readonly startedAt: number;
  private status: AudioTtsSessionStatus = "playing";
  private endCbs: Array<() => void> = [];
  private readonly spectrumSource: AudioSpectrumSource;
  private readonly pcmData: {
    readonly sampleRate: number;
    readonly channels: ReadonlyArray<Float32Array>;
  };
  private readonly capability: AudioTtsCapability;

  constructor(opts: {
    text: string;
    durationMs: number;
    pcm: Float32Array;
    sampleRate: number;
    capability: AudioTtsCapability;
  }) {
    this.id = `local-pcm-${Math.random().toString(36).slice(2, 10)}`;
    this.text = opts.text;
    this.durationMs = opts.durationMs;
    this.startedAt = Date.now();
    this.pcmData = {
      sampleRate: opts.sampleRate,
      channels: [opts.pcm] as ReadonlyArray<Float32Array>,
    };
    this.spectrumSource = new PcmSpectrumSource({
      sampleRate: opts.sampleRate,
      channelData: opts.pcm,
    });
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

  getPcm(): {
    readonly sampleRate: number;
    readonly channels: ReadonlyArray<Float32Array>;
  } | null {
    return this.pcmData;
  }

  /** 本会话携带的频谱源（PCM -> FFT），供上层探针拉取频域数据。 */
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
 * PCM fixture 型音频 TTS 提供方：用合成元音 PCM 模拟"可分析音频播放"。
 * 实现 Day11A 的 AudioTtsProvider，但 PCM 来自数学合成，不接任何真实引擎。
 */
export class LocalPcmFixtureTtsProvider implements AudioTtsProvider {
  readonly id = "local-pcm-fixture-tts";
  readonly name = "Local PCM Fixture TTS (synthetic vowel PCM, no real audio)";
  private readonly sampleRate: number;
  private readonly capability: AudioTtsCapability = PCM_FIXTURE_CAPABILITY;
  private activeSession: LocalPcmFixturePlaybackSession | null = null;

  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate =
      Number.isFinite(opts?.sampleRate) && (opts?.sampleRate ?? 0) > 0
        ? opts!.sampleRate!
        : 44100;
  }

  isAvailable(): boolean {
    return true;
  }

  getCapability(): AudioTtsCapability {
    return this.capability;
  }

  /** 返回具体会话类型，便于上层直接取 PCM 与频谱源。 */
  speak(text: string, _options?: AudioTtsSpeakOptions): LocalPcmFixturePlaybackSession {
    const safeText = text ?? "";
    const durationMs = Math.max(500, safeText.length * 150);
    const pcm = buildMultiVowelPcm(this.sampleRate, durationMs);
    const session = new LocalPcmFixturePlaybackSession({
      text: safeText,
      durationMs,
      pcm,
      sampleRate: this.sampleRate,
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

/** 便利工厂：构造一个默认参数的 PCM fixture provider。 */
export function createLocalPcmFixtureTtsProvider(opts?: {
  sampleRate?: number;
}): LocalPcmFixtureTtsProvider {
  return new LocalPcmFixtureTtsProvider(opts);
}

export { VOWEL_PARAMS };
