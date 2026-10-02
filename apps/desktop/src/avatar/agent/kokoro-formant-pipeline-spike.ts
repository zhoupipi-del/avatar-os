/**
 * Day14A — Kokoro Formant Pipeline Spike
 *
 * 把 Day14A 的 kokoro provider spike、Day11C 的频谱探针、Day11B 的共振峰分析器
 * 串成一条端到端测试闭环（真实 kokoro 后端为可选）：
 *
 *   provider.speak(text)
 *     -> session.load()（kokoro 合成 PCM，或 graceful fallback 到静音）
 *     -> session.getSpectrumSource()
 *     -> FormantVisemeRuntimeProbe.update() x N
 *     -> aa / ih / ou / ee / oh
 *
 * 本模块不接 VRM、不接 UI、不写表情、不创建任何音频对象；
 * 只是把已验证的零件组合成"说话 -> 分析口型"的便利封装，用于 spike 闭环与后续接线参考。
 *
 * 红线（不做的）：不写表情、不接皮肤组件 / 语音控制器 / 口型面板、不引入真实 TTS 硬依赖。
 */

import { KokoroProviderSpike, KokoroPlaybackSession } from "./kokoro-provider-spike";
import { FormantVisemeRuntimeProbe } from "./formant-viseme-runtime-probe";
import { type FormantVisemeResult } from "./formant-viseme-analyzer";

export interface KokoroPipelineResult {
  /** 本次会话的文本 */
  readonly sessionText: string;
  /** 逐帧分析结果（仅含非 null 帧） */
  readonly results: FormantVisemeResult[];
  /** 命中有效人声段的帧数 */
  readonly activeCount: number;
  /** 出现过的元音分类 reason 集合（去重），便于断言覆盖度 */
  readonly reasons: string[];
  /** 本次是否走了真实 kokoro 后端（false = graceful fallback） */
  readonly available: boolean;
}

export interface KokoroFormantPipelineSpikeOptions {
  /** speakAndAnalyze 默认分析的帧数 */
  readonly defaultFrameCount?: number;
  /** 透传给 analyzer 的底噪门限 */
  readonly noiseGate?: number;
}

/**
 * kokoro provider -> formant 口型 的 spike 闭环管线。
 * 不写表情、不接 VRM、不依赖真实浏览器音频。
 */
export class KokoroFormantPipelineSpike {
  private readonly provider: KokoroProviderSpike;
  private readonly defaultFrameCount: number;
  private readonly noiseGate: number | undefined;
  private session: KokoroPlaybackSession | null = null;
  private probe: FormantVisemeRuntimeProbe | null = null;

  constructor(provider: KokoroProviderSpike, options?: KokoroFormantPipelineSpikeOptions) {
    this.provider = provider;
    this.defaultFrameCount =
      Number.isFinite(options?.defaultFrameCount) && (options?.defaultFrameCount ?? 0) > 0
        ? Math.floor(options!.defaultFrameCount!)
        : 10;
    this.noiseGate = options?.noiseGate;
  }

  /**
   * 说话并逐帧分析口型，返回聚合结果（异步：真实 kokoro 合成为异步加载）。
   * 任何一步抛错都不向上传播（测试闭环不允许把异常抛给调用方）。
   */
  async speakAndAnalyze(text: string, frameCount?: number): Promise<KokoroPipelineResult> {
    const frames =
      Number.isFinite(frameCount) && (frameCount ?? 0) > 0
        ? Math.floor(frameCount!)
        : this.defaultFrameCount;

    let session: KokoroPlaybackSession;
    try {
      session = this.provider.speak(text);
    } catch {
      return { sessionText: text ?? "", results: [], activeCount: 0, reasons: [], available: false };
    }
    this.session = session;

    // 异步合成 PCM（真实后端或 graceful fallback 到静音）
    try {
      await session.load();
    } catch {
      // 合成失败：继续用静音频谱源，结果为空
    }

    const available = this.provider.isAvailable() && session.getPcm() !== null;

    let source;
    try {
      source = session.getSpectrumSource();
    } catch {
      return { sessionText: session.text, results: [], activeCount: 0, reasons: [], available };
    }

    const probe = new FormantVisemeRuntimeProbe(source, { noiseGate: this.noiseGate });
    this.probe = probe;

    const results: FormantVisemeResult[] = [];
    const reasons = new Set<string>();
    for (let i = 0; i < frames; i++) {
      let r: FormantVisemeResult | null = null;
      try {
        r = probe.update();
      } catch {
        r = null;
      }
      if (r) {
        results.push(r);
        reasons.add(r.reason);
      }
    }

    return {
      sessionText: session.text,
      results,
      activeCount: results.filter((x) => x.active).length,
      reasons: Array.from(reasons),
      available,
    };
  }

  /** 清空探针历史与计数，保留当前会话。 */
  reset(): void {
    this.probe?.reset();
  }

  /** 取消当前会话并断开探针（可重复调用）。 */
  cancel(): void {
    try {
      this.session?.cancel();
    } catch {
      // 取消失败不影响其他逻辑
    }
    try {
      this.provider.cancel();
    } catch {
      // 取消失败不影响其他逻辑
    }
    this.probe = null;
    this.session = null;
  }
}

/** 工厂：用 kokoro provider spike 组装一条完整测试闭环管线。 */
export function createKokoroFormantPipelineSpike(
  provider: KokoroProviderSpike,
  options?: KokoroFormantPipelineSpikeOptions,
): KokoroFormantPipelineSpike {
  return new KokoroFormantPipelineSpike(provider, options);
}

/** 探测 kokoro 后端是否可用（供测试 graceful skip 用）。 */
export async function isKokoroPipelineAvailable(): Promise<boolean> {
  const p = new KokoroProviderSpike();
  return p.isAvailable();
}
