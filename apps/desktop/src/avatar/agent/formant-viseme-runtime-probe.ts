/**
 * Day11C — Formant Viseme Runtime Probe（频谱→口型 探针编排器）
 *
 * 职责：从 AudioSpectrumSource 拉一帧频域数据，喂给 analyzeFormantViseme，
 * 缓存并暴露最近一次分析结果，供上层（Day12 的 runtime bridge / debug UI）读取。
 *
 *   source.getFrequencyData() → analyzeFormantViseme() → lastResult
 *
 * 红线（本文件不做的）：
 * - 不写表情、不接 VRM、不 import 任何 runtime 组件
 * - 不创建运行时音频对象、不连接音频节点
 * - 不接真实 TTS 引擎——source 只能是纯数据实现（Day11C 阶段）
 */

import type { AudioSpectrumSource } from "./audio-spectrum-source";
import { analyzeFormantViseme, type FormantVisemeResult } from "./formant-viseme-analyzer";

export interface FormantVisemeProbeStatus {
  /** 最近一次分析是否命中有效人声段 */
  active: boolean;
  /** 最近一次分析结果；尚未 update 或已 reset 时为 null */
  lastResult: FormantVisemeResult | null;
  /** 累计成功执行的 update 次数（reset 后清零） */
  updateCount: number;
  /** 最近一次分析的分类原因（无结果时为 "no-update"） */
  lastReason: string;
}

export interface FormantVisemeProbeOptions {
  /** 透传给 analyzer 的底噪门限 */
  noiseGate?: number;
}

/**
 * 探针本体：持有一个频谱源，按需(update)逐帧分析。
 * 无内部定时器——由调用方决定节奏（测试里手动调用；Day12 才由帧循环驱动）。
 */
export class FormantVisemeRuntimeProbe {
  private source: AudioSpectrumSource | null;
  private readonly noiseGate: number | undefined;
  private lastResult: FormantVisemeResult | null = null;
  private updateCount = 0;

  constructor(source: AudioSpectrumSource | null, options?: FormantVisemeProbeOptions) {
    this.source = source ?? null;
    this.noiseGate = options?.noiseGate;
  }

  /** 替换频谱源（置 null 表示断开）。不清空历史结果，由调用方决定是否 reset。 */
  setSource(source: AudioSpectrumSource | null): void {
    this.source = source ?? null;
  }

  /**
   * 拉一帧频谱并分析。无 source 时返回 null 且不计数。
   * source 抛错时吞掉异常并返回 null（探针不允许把异常抛给上层帧循环）。
   */
  update(): FormantVisemeResult | null {
    if (!this.source) {
      return null;
    }
    let frequencyData: Uint8Array;
    let sampleRate: number;
    try {
      frequencyData = this.source.getFrequencyData();
      sampleRate = this.source.sampleRate;
    } catch {
      return null;
    }
    const result = analyzeFormantViseme({
      frequencyData,
      sampleRate,
      noiseGate: this.noiseGate,
    });
    this.lastResult = result;
    this.updateCount += 1;
    return result;
  }

  getStatus(): FormantVisemeProbeStatus {
    return {
      active: this.lastResult?.active ?? false,
      lastResult: this.lastResult,
      updateCount: this.updateCount,
      lastReason: this.lastResult?.reason ?? "no-update",
    };
  }

  /** 断开源并清空状态（等价 reset + setSource(null)）。 */
  cancel(): void {
    this.source = null;
    this.reset();
  }

  /** 清空历史结果与计数，保留当前 source。 */
  reset(): void {
    this.lastResult = null;
    this.updateCount = 0;
  }
}
