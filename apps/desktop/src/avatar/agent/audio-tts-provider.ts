/**
 * Day11A — Audio TTS Pipeline Probe
 *
 * 目标：为真实音频 LipSync 建立"可分析音频"的 TTS 能力口子（probe），
 * 但 **不替换** 当前稳定产品语音 BrowserTtsController，也不接任何真实音频驱动。
 *
 * 为什么需要它（见 avataros-reference-analysis.md §5）：
 * - SAP 共振峰路线需要 TTS 暴露一个可接 AnalyserNode 的 AudioNode（MediaElementSource / AudioBufferSourceNode）。
 * - airi wLipSync 路线需要 TTS 产出 AudioBuffer（WAV/ArrayBuffer → AudioBufferSourceNode）。
 * - 当前 BrowserTtsController 走 Web Speech `speechSynthesis`，**不暴露任何 AudioNode**，
 *   因此 capability 全 false —— 这正是 Day11A 要暴露的事实：
 *   真实音频 LipSync 必须先有 supportsAudioNode / supportsAudioBuffer 的 TTS 提供方。
 *
 * 红线（本文件不做的）：
 * - 不写 AudioContext / AnalyserNode / AudioBufferSourceNode 实现
 * - 不引入真实音频 TTS 引擎依赖（云端/本地流式与 ML 语音合成库、wLipSync 运行时等）
 * - 不调用 expressionManager.setValue（不驱动口型）
 * - 不修改 BrowserTtsController
 */

/** TTS 提供方能够交付的"可分析音频"能力描述。 */
export interface AudioTtsCapability {
  /**
   * 提供方能暴露一个可接入 AnalyserNode 的 AudioNode
   * （如 MediaElementSource / AudioBufferSourceNode）。
   * SAP 共振峰(F1/F2)路线需要：AudioNode → AnalyserNode → getByteFrequencyData。
   */
  readonly supportsAudioNode: boolean;
  /**
   * 提供方能产出 AudioBuffer（WAV/PCM → AudioBufferSourceNode）。
   * airi wLipSync 路线需要：AudioBufferSourceNode → wLipSync → AEIOUS。
   */
  readonly supportsAudioBuffer: boolean;
  /**
   * 提供方能直接给出 PCM 采样（Float32 通道 + sampleRate），用于离线分析。
   */
  readonly supportsPcm: boolean;
}

/** 所有音频能力都为 false 的常量（如当前 BrowserTtsController）。 */
export const NO_AUDIO_TTS_CAPABILITY: AudioTtsCapability = Object.freeze({
  supportsAudioNode: false,
  supportsAudioBuffer: false,
  supportsPcm: false,
});

export type AudioTtsSessionStatus = "idle" | "playing" | "ended" | "cancelled";

/** 一次 TTS 播放会话的音频能力视图。 */
export interface AudioTtsPlaybackSession {
  readonly id: string;
  getCapability(): AudioTtsCapability;
  getStatus(): AudioTtsSessionStatus;
  /** 若 supportsAudioNode，返回可接 AnalyserNode 的 AudioNode；否则 null。 */
  getAudioNode(): AudioNode | null;
  /** 若 supportsAudioBuffer，返回 AudioBuffer；否则 null。 */
  getAudioBuffer(): AudioBuffer | null;
  /** 若 supportsPcm，返回 PCM 采样；否则 null。 */
  getPcm(): { readonly sampleRate: number; readonly channels: ReadonlyArray<Float32Array> } | null;
  cancel(): void;
  onEnd(cb: () => void): void;
}

export interface AudioTtsSpeakOptions {
  readonly lang?: string;
  readonly rate?: number;
  readonly pitch?: number;
  readonly volume?: number;
}

/** 可插拔音频 TTS 提供方接口（Day11B/Day11C 的真实实现将实现它）。 */
export interface AudioTtsProvider {
  readonly id: string;
  readonly name: string;
  isAvailable(): boolean;
  getCapability(): AudioTtsCapability;
  speak(text: string, options?: AudioTtsSpeakOptions): AudioTtsPlaybackSession;
  cancel(): void;
}

/**
 * 占位播放会话：证明 AudioTtsPlaybackSession 接口可实例化，
 * 但不接任何真实音频、不驱动 expression。
 */
class NoopPlaybackSession implements AudioTtsPlaybackSession {
  readonly id: string;
  private status: AudioTtsSessionStatus = "idle";
  private endCbs: Array<() => void> = [];

  constructor() {
    this.id = `noop-${Math.random().toString(36).slice(2, 10)}`;
  }

  getCapability(): AudioTtsCapability {
    return NO_AUDIO_TTS_CAPABILITY;
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
    for (const cb of cbs) {
      cb();
    }
  }
}

/**
 * 占位提供方：capability 全 false，isAvailable=false。
 * 它的存在只是证明 AudioTtsProvider 接口可落地，
 * 并作为后续 Day11B(DAP formant) / Day11C(airi wLipSync) 实现的基类参照。
 *
 * 注意：这不是 BrowserTtsController 的替代品。BrowserTtsController 仍是当前产品语音，
 * 它只是不产生"可分析音频"。
 */
export class UnsupportedAudioTtsProvider implements AudioTtsProvider {
  readonly id = "unsupported-audio-tts";
  readonly name = "Unsupported Audio TTS (no analyzable audio)";
  private readonly capability: AudioTtsCapability = NO_AUDIO_TTS_CAPABILITY;

  isAvailable(): boolean {
    return false;
  }

  getCapability(): AudioTtsCapability {
    return this.capability;
  }

  speak(_text: string, _options?: AudioTtsSpeakOptions): AudioTtsPlaybackSession {
    return new NoopPlaybackSession();
  }

  cancel(): void {
    // no-op：占位提供方没有进行中的会话。
  }
}

/**
 * 描述当前 BrowserTtsController（speechSynthesis）的音频能力。
 * 不修改 BrowserTtsController 本身 —— 仅在此声明它不暴露 AudioNode / AudioBuffer / PCM。
 */
export function describeBrowserTtsCapability(): AudioTtsCapability {
  return NO_AUDIO_TTS_CAPABILITY;
}
