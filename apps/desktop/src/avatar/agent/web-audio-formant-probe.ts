/**
 * Day12 — WebAudio Runtime Bridge: Formant Probe
 *
 * 把 WebAudioSpectrumSource 接到 Day11C 的 FormantVisemeRuntimeProbe，
 * 形成一条独立的"频谱 → 口型"桥：
 *
 *   WebAudioSpectrumSource.getFrequencyData() → FormantVisemeRuntimeProbe.update() → FormantVisemeResult
 *
 * 本模块不写 expression、不接 VRM、不创建音频对象、不依赖真实 DOM Audio，
 * 只是把两个已验证的零件组合成面向"WebAudio 频谱源"的便利封装。
 */

import { WebAudioSpectrumSource } from "./web-audio-spectrum-source";
import { FormantVisemeRuntimeProbe } from "./formant-viseme-runtime-probe";
import type { FormantVisemeResult } from "./formant-viseme-analyzer";

export interface WebAudioFormantProbeStatus {
  /** 最近一次分析是否命中有效人声段 */
  active: boolean;
  /** 最近一次分析结果；尚未 update 时为 null */
  lastResult: FormantVisemeResult | null;
  /** 累计成功执行的 update 次数 */
  updateCount: number;
  /** 最近一次分析的分类原因 */
  lastReason: string;
  /** 底层频谱源采样率（便于上层换算 bin↔频率） */
  sourceSampleRate: number;
}

export interface WebAudioFormantProbeOptions {
  /** 透传给 analyzer 的底噪门限 */
  noiseGate?: number;
}

/**
 * WebAudio 频谱 → 口型探针：封装 FormantVisemeRuntimeProbe，面向 WebAudioSpectrumSource。
 * 不写表情、不接 VRM、不创建音频对象。
 */
export class WebAudioFormantProbe {
  private readonly source: WebAudioSpectrumSource;
  private readonly probe: FormantVisemeRuntimeProbe;

  constructor(source: WebAudioSpectrumSource, options?: WebAudioFormantProbeOptions) {
    this.source = source;
    this.probe = new FormantVisemeRuntimeProbe(source, { noiseGate: options?.noiseGate });
  }

  /** 拉一帧并分析；返回口型结果或 null（无源 / 拉取失败）。 */
  update(): FormantVisemeResult | null {
    return this.probe.update();
  }

  getStatus(): WebAudioFormantProbeStatus {
    const s = this.probe.getStatus();
    return {
      active: s.active,
      lastResult: s.lastResult,
      updateCount: s.updateCount,
      lastReason: s.lastReason,
      sourceSampleRate: this.source.sampleRate,
    };
  }

  /** 安全释放频谱源（可重复调用）。 */
  dispose(): void {
    try {
      this.source.dispose();
    } catch {
      // 释放失败不影响其他逻辑
    }
  }
}

/** 工厂：用已构造的 WebAudioSpectrumSource 直接组装一条完整 bridge。 */
export function createWebAudioFormantProbe(
  source: WebAudioSpectrumSource,
  options?: WebAudioFormantProbeOptions,
): WebAudioFormantProbe {
  return new WebAudioFormantProbe(source, options);
}
