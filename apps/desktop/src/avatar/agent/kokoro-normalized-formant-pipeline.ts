/**
 * Day14D — Kokoro Normalized Formant Pipeline
 *
 * 把 Day14D normalizer 与既有频谱/口型零件串成稳定分析管线：
 *
 *   unknown kokoro output
 *     -> normalizeKokoroAudioOutput()      (Day14D)
 *     -> PcmSpectrumSource                 (Day13C)
 *     -> FormantVisemeRuntimeProbe.update()(Day11C)
 *     -> aa / ih / ou / ee / oh summary
 *
 * 纯数据管线：不发网络请求、不触发模型下载、不创建音频对象。
 *
 * 红线（本文件不做的）：
 * - 不接 VRM / UI / 产品语音控制器 / 皮肤组件 / 口型面板
 * - 不写表情 / 不驱动口型
 * - 不创建运行时音频对象、不连接音频节点
 */

import { normalizeKokoroAudioOutput, type KokoroNormalizeOptions } from "./kokoro-output-normalizer";
import { PcmSpectrumSource } from "./pcm-spectrum-source";
import { FormantVisemeRuntimeProbe } from "./formant-viseme-runtime-probe";
import type { FormantVisemeResult, MouthShape } from "./formant-viseme-analyzer";

export interface NormalizedKokoroAnalysisOptions extends KokoroNormalizeOptions {
  /** FFT 窗口大小（透传 PcmSpectrumSource，默认 1024，须为 2 的幂） */
  readonly frameSize?: number;
  /** 透传 analyzer 的底噪门限 */
  readonly noiseGate?: number;
  /** 最多分析多少帧（默认 64，防止超长 PCM 拖慢测试） */
  readonly maxFrames?: number;
}

export interface NormalizedKokoroAnalysisSummary {
  /** 归一化是否成功 */
  readonly normalized: boolean;
  /** 归一化后的采样率（失败时为 0） */
  readonly sampleRate: number;
  /** 实际分析的帧数 */
  readonly frameCount: number;
  /** 命中有效人声段的帧数 */
  readonly activeResultCount: number;
  /** 各 active 帧最大权重口型的去重集合 */
  readonly dominantShapes: ReadonlyArray<MouthShape>;
  /** 出现过的分类 reason 去重集合 */
  readonly reasons: ReadonlyArray<string>;
  /** 逐帧结果（仅 active 帧） */
  readonly results: ReadonlyArray<FormantVisemeResult>;
  /** 归一化失败时的错误说明（成功为 null） */
  readonly error: string | null;
}

/** 从单帧结果取最大权重口型（全 0 时返回 null）。 */
function dominantShapeOf(result: FormantVisemeResult): MouthShape | null {
  const entries = Object.entries(result.weights) as Array<[MouthShape, number]>;
  let best: MouthShape | null = null;
  let bestW = 0;
  for (const [shape, w] of entries) {
    if (w > bestW) {
      bestW = w;
      best = shape;
    }
  }
  return best;
}

/**
 * 主入口：unknown kokoro 输出 -> 归一化 -> 频谱 -> 口型 summary。
 * 任何一步失败都返回结构化 summary（normalized=false + error），绝不 throw。
 */
export function analyzeNormalizedKokoroOutput(
  output: unknown,
  options?: NormalizedKokoroAnalysisOptions,
): NormalizedKokoroAnalysisSummary {
  const failure = (error: string): NormalizedKokoroAnalysisSummary => ({
    normalized: false,
    sampleRate: 0,
    frameCount: 0,
    activeResultCount: 0,
    dominantShapes: [],
    reasons: [],
    results: [],
    error,
  });

  try {
    const normalized = normalizeKokoroAudioOutput(output, {
      fallbackSampleRate: options?.fallbackSampleRate,
    });
    if (!normalized.ok || !normalized.pcm) {
      return failure(normalized.error ?? "normalization failed");
    }

    const pcm = normalized.pcm;
    const source = new PcmSpectrumSource({
      sampleRate: pcm.sampleRate,
      channelData: pcm.channels[0],
      frameSize: options?.frameSize,
    });
    const probe = new FormantVisemeRuntimeProbe(source, { noiseGate: options?.noiseGate });

    const frameSize =
      Number.isFinite(options?.frameSize) && (options?.frameSize ?? 0) > 0
        ? Math.floor(options!.frameSize!)
        : 1024;
    const maxFrames =
      Number.isFinite(options?.maxFrames) && (options?.maxFrames ?? 0) > 0
        ? Math.floor(options!.maxFrames!)
        : 64;
    const availableFrames = Math.floor(pcm.frameCount / frameSize);
    const frames = Math.min(availableFrames, maxFrames);

    const results: FormantVisemeResult[] = [];
    const reasons = new Set<string>();
    const shapes = new Set<MouthShape>();
    for (let i = 0; i < frames; i++) {
      const r = probe.update();
      if (!r) continue;
      reasons.add(r.reason);
      if (r.active) {
        results.push(r);
        const shape = dominantShapeOf(r);
        if (shape) shapes.add(shape);
      }
    }

    return {
      normalized: true,
      sampleRate: pcm.sampleRate,
      frameCount: frames,
      activeResultCount: results.length,
      dominantShapes: Array.from(shapes),
      reasons: Array.from(reasons),
      results,
      error: null,
    };
  } catch (err) {
    return failure(`pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 便利封装：持有默认 options，可重复对多个输出做分析。
 * reset 幂等（内部无跨调用状态，每次 analyze 均为全新管线）。
 */
export class KokoroNormalizedFormantPipeline {
  private readonly options: NormalizedKokoroAnalysisOptions | undefined;

  constructor(options?: NormalizedKokoroAnalysisOptions) {
    this.options = options;
  }

  analyze(output: unknown): NormalizedKokoroAnalysisSummary {
    return analyzeNormalizedKokoroOutput(output, this.options);
  }

  /** 幂等 reset：管线无跨调用状态，保留以对齐既有 pipeline 形状。 */
  reset(): void {
    // 每次 analyze 都构建全新 source + probe，无状态需要清理。
  }
}

/** 工厂：构造带默认 options 的归一化分析管线。 */
export function createKokoroNormalizedFormantPipeline(
  options?: NormalizedKokoroAnalysisOptions,
): KokoroNormalizedFormantPipeline {
  return new KokoroNormalizedFormantPipeline(options);
}
