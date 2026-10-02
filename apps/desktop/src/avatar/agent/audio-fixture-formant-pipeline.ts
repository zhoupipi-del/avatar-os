/**
 * Day13A — Audio Fixture Formant Pipeline
 *
 * 把 Day13A 的 fixture provider、Day11C 的频谱源 + 探针、Day11B 的共振峰分析器
 * 串成一条端到端测试闭环：
 *
 *   provider.speak(text)
 *     → session.getSpectrumSource()
 *     → FormantVisemeRuntimeProbe.update() × N
 *     → FormantVisemeResult[]（aa/ih/ou/ee/oh）
 *
 * 本模块不接 VRM、不接 UI、不写表情、不创建任何音频对象；
 * 只是把已验证的零件组合成"说话 → 分析口型"的便利封装，用于测试闭环与后续接线参考。
 *
 * 红线（不做的）：不写表情、不接皮肤组件 / 语音控制器 / 口型面板、不引入真实 TTS 依赖。
 */

import { AudioFixtureTtsProvider, AudioFixturePlaybackSession } from "./audio-fixture-tts-provider";
import { FormantVisemeRuntimeProbe } from "./formant-viseme-runtime-probe";
import type { FormantVisemeResult } from "./formant-viseme-analyzer";

export interface AudioFixturePipelineResult {
  /** 本次会话的文本 */
  readonly sessionText: string;
  /** 逐帧分析结果（仅含非 null 帧） */
  readonly results: FormantVisemeResult[];
  /** 命中有效人声段的帧数 */
  readonly activeCount: number;
  /** 出现过的元音分类 reason 集合（去重），便于断言覆盖度 */
  readonly reasons: string[];
}

export interface AudioFixtureFormantPipelineOptions {
  /** speakAndAnalyze 默认分析的帧数 */
  readonly defaultFrameCount?: number;
  /** 透传给 analyzer 的底噪门限 */
  readonly noiseGate?: number;
}

/**
 * fixture provider → formant 口型 的测试闭环管线。
 * 不写表情、不接 VRM、不依赖真实浏览器音频。
 */
export class AudioFixtureFormantPipeline {
  private readonly provider: AudioFixtureTtsProvider;
  private readonly defaultFrameCount: number;
  private readonly noiseGate: number | undefined;
  private session: AudioFixturePlaybackSession | null = null;
  private probe: FormantVisemeRuntimeProbe | null = null;

  constructor(provider: AudioFixtureTtsProvider, options?: AudioFixtureFormantPipelineOptions) {
    this.provider = provider;
    this.defaultFrameCount =
      Number.isFinite(options?.defaultFrameCount) && (options?.defaultFrameCount ?? 0) > 0
        ? Math.floor(options!.defaultFrameCount!)
        : 10;
    this.noiseGate = options?.noiseGate;
  }

  /**
   * 说话并逐帧分析口型，返回聚合结果。
   * 任何一步抛错都不向上传播（测试闭环不允许把异常抛给调用方）。
   */
  speakAndAnalyze(text: string, frameCount?: number): AudioFixturePipelineResult {
    const frames = Number.isFinite(frameCount) && (frameCount ?? 0) > 0 ? Math.floor(frameCount!) : this.defaultFrameCount;
    let session: AudioFixturePlaybackSession;
    try {
      session = this.provider.speak(text);
    } catch {
      return { sessionText: text ?? "", results: [], activeCount: 0, reasons: [] };
    }
    this.session = session;

    let source;
    try {
      source = session.getSpectrumSource();
    } catch {
      return { sessionText: session.text, results: [], activeCount: 0, reasons: [] };
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

/** 工厂：用 fixture provider 组装一条完整测试闭环管线。 */
export function createAudioFixtureFormantPipeline(
  provider: AudioFixtureTtsProvider,
  options?: AudioFixtureFormantPipelineOptions,
): AudioFixtureFormantPipeline {
  return new AudioFixtureFormantPipeline(provider, options);
}
