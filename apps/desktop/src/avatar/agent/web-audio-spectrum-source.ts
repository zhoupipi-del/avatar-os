/**
 * Day12 — WebAudio Runtime Bridge: Spectrum Source
 *
 * 把浏览器真实音频分析能力封成一个独立 bridge，实现 Day11C 的 AudioSpectrumSource 接口：
 *
 *   音频元素 / 媒体元素 → WebAudio bridge → frequencyData → AudioSpectrumSource
 *
 * 设计要点（依赖注入，不创建音频对象）：
 * - 本模块不实例化任何 Web Audio 节点（音频上下文 / 分析节点 / 媒体元素源 / 音频元素）。
 * - 改由调用方把"拉取频域数据的函数"（如真实分析节点的字节频域数据包装）通过
 *   `pullFrequencyData` 注入。本模块只负责按 AudioSpectrumSource 契约返回 Uint8Array。
 *   → 真实音频接线推迟到 Day13，本阶段只在 isolated module + 测试验证，不进产品 runtime。
 *
 * 红线（不做的）：不写音频上下文 / 分析节点实现、不接真实 TTS、不驱动表情、
 * 不 import 任何产品 runtime 组件（皮肤组件 / 语音控制器 / 口型控制面板 / 表情写入器）。
 */

import type { AudioSpectrumSource } from "./audio-spectrum-source";

export interface WebAudioSpectrumSourceOptions {
  /** 采样率 (Hz)，用于 analyzer 把 bin 序号换算为频率 */
  readonly sampleRate: number;
  /** 频域 bin 数量（= AnalyserNode.frequencyBinCount） */
  readonly frequencyBinCount: number;
  /**
   * 拉取频域数据的注入函数：把当前帧的频域幅度 (0~255) 写入传入的 Uint8Array。
   * 真实场景下由调用方用真实分析节点的字节频域数据包装后传入；
   * 测试场景由 fake analyser 提供。本模块从不自行创建任何音频对象。
   */
  readonly pullFrequencyData: (data: Uint8Array) => void;
  /** 可选的释放钩子（如断开 AudioContext / 停止 MediaElement），可重复调用 */
  readonly dispose?: () => void;
}

/**
 * 真实浏览器音频频谱源（依赖注入版）：实现 Day11C 的 AudioSpectrumSource。
 * 通过注入的 pullFrequencyData 拿频域数据，自身不持有任何 WebAudio 节点。
 */
export class WebAudioSpectrumSource implements AudioSpectrumSource {
  readonly sampleRate: number;
  private readonly frequencyBinCount: number;
  private readonly pull: (data: Uint8Array) => void;
  private readonly disposeHook: (() => void) | undefined;
  private buffer: Uint8Array;

  constructor(options: WebAudioSpectrumSourceOptions) {
    this.sampleRate =
      Number.isFinite(options.sampleRate) && options.sampleRate > 0
        ? options.sampleRate
        : 0;
    this.frequencyBinCount =
      Number.isFinite(options.frequencyBinCount) && options.frequencyBinCount > 0
        ? Math.floor(options.frequencyBinCount)
        : 0;
    this.pull = options.pullFrequencyData;
    this.disposeHook = options.dispose;
    this.buffer = new Uint8Array(this.frequencyBinCount);
  }

  getFrequencyData(): Uint8Array {
    // 复用内部 buffer，避免每帧分配
    if (this.buffer.length !== this.frequencyBinCount) {
      this.buffer = new Uint8Array(this.frequencyBinCount);
    }
    try {
      this.pull(this.buffer);
    } catch {
      // 拉取失败视为静音帧：填 0，不向上抛异常（探针不允许把异常抛给帧循环）
      this.buffer.fill(0);
    }
    // 返回防御性副本，防止调用方原地修改污染内部状态
    return new Uint8Array(this.buffer);
  }

  /** 安全释放：调用注入的 dispose 钩子（若有）；可重复调用不抛错。 */
  dispose(): void {
    try {
      this.disposeHook?.();
    } catch {
      // 释放失败不影响其他逻辑
    }
  }
}
