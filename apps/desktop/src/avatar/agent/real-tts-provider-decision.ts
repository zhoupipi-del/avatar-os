/**
 * Day13B — Real TTS Provider Evaluation（决策模块，纯评估逻辑）
 *
 * 本模块只做"三候选路线"的许可证 / 运行时 / 打包 / 离线 / 浏览器支持 / 预期音频输出
 * 的评估与排序，**不实现任何真实 TTS 接线**，也不引入任何真实 TTS 包。
 *
 * 候选（仅评估，不下场实现）：
 * - edge：基于 Edge 在线朗读服务的非官方封装（实现快，但在线/协议/许可证风险高）
 * - kokoro：本地 ML 语音库（MIT，有离线本地运行案例，但带来模型包/WASM/WebGPU/首包加载成本）
 * - piper：本地 ML 语音库（MIT，离线潜力强，但模型/wasm/中文音色/打包路径需验证）
 *
 * 本阶段不接产品 runtime、不让 VOID 嘴动。真实接线推迟到 Day13C/D spike。
 *
 * 红线（本文件不做的）：
 * - 不 import 任何真实 TTS 包（edge / kokoro / piper 的 npm 包均不引）
 * - 不创建任何音频上下文 / 媒体元素 / 缓冲源
 * - 不写表情、不接 VRM / 皮肤组件 / 语音控制器 / 口型面板
 */

/** 真实 TTS 候选标识（仅用于评估，与具体 npm 包名解耦）。 */
export type RealTtsProviderCandidate = "edge" | "kokoro" | "piper";

/** 风险等级。 */
export type RiskLevel = "low" | "medium" | "high";

/** 候选预期产出的音频形态（决定后续该走 AudioNode 还是 AudioBuffer 路线）。 */
export type RealTtsAudioOutput = "wav" | "pcm" | "audio-buffer" | "unknown";

/** 单条候选的结构化评估结论。 */
export interface RealTtsProviderEvaluation {
  readonly candidate: RealTtsProviderCandidate;
  /** 许可证传染 / 合规风险。 */
  readonly licenseRisk: RiskLevel;
  /** 运行时依赖（在线服务可用性、API 稳定性、首包加载等）。 */
  readonly runtimeRisk: RiskLevel;
  /** 打包 / 分发复杂度（模型权重、WASM、WebGPU 等）。 */
  readonly packagingRisk: RiskLevel;
  /** 是否支持离线运行。 */
  readonly offlineSupport: boolean;
  /** 是否能在浏览器 / WebView 上下文运行（AvatarOS 桌面端走 Tauri WebView）。 */
  readonly browserSupport: boolean;
  /** 预期可拿到的音频形态。 */
  readonly expectedAudioOutput: RealTtsAudioOutput;
  /** 评估备注（含关键权衡与未决项）。 */
  readonly notes: string;
}

const RISK_WEIGHT: Readonly<Record<RiskLevel, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
});

/**
 * 对单条候选做结构化评估。
 * 数据来源：Day13B 指令中的三候选权衡 + 当前外部信息（许可证标注、运行形态、离线案例）。
 * 不引入任何外部依赖，纯本地常量。
 */
export function evaluateRealTtsProvider(
  candidate: RealTtsProviderCandidate,
): RealTtsProviderEvaluation {
  switch (candidate) {
    case "edge":
      return {
        candidate: "edge",
        licenseRisk: "high",
        runtimeRisk: "high",
        packagingRisk: "medium",
        offlineSupport: false,
        browserSupport: true,
        expectedAudioOutput: "wav",
        notes:
          "实现最快：调用在线朗读服务即可拿到音频流。但属于非官方封装，" +
          "服务协议与 API 稳定性不在掌控，且相关 JS 包许可证标注偏严格（GPLv3 类），" +
          "对 AvatarOS 的分发与长期稳定性都要谨慎；无离线能力。",
      };
    case "kokoro":
      return {
        candidate: "kokoro",
        licenseRisk: "low",
        runtimeRisk: "medium",
        packagingRisk: "medium",
        offlineSupport: true,
        browserSupport: true,
        expectedAudioOutput: "audio-buffer",
        notes:
          "本地潜力最强：MIT 许可证、有离线本地运行案例。代价是需随包分发模型权重，" +
          "并承担 WASM / WebGPU 运行时与首包加载时延；中文音色质量需实机验证。",
      };
    case "piper":
      return {
        candidate: "piper",
        licenseRisk: "low",
        runtimeRisk: "medium",
        packagingRisk: "medium",
        offlineSupport: true,
        browserSupport: true,
        expectedAudioOutput: "audio-buffer",
        notes:
          "本地离线潜力强：MIT 类许可证，音频流可直接转 AudioBuffer 接下游分析。" +
          "但前端方案本质是浏览器库，需打包 wasm 与模型文件，中文音色的可得性与打包路径需 spike 验证。",
      };
    default: {
      // 穷尽检查：联合类型外不应到达此处。
      const _exhaustive: never = candidate;
      throw new Error(`unknown real TTS candidate: ${String(_exhaustive)}`);
    }
  }
}

/** 综合风险评分（越低越优）。离线支持给予减分优待。 */
function scoreOf(e: RealTtsProviderEvaluation): number {
  let s = RISK_WEIGHT[e.licenseRisk] + RISK_WEIGHT[e.runtimeRisk] + RISK_WEIGHT[e.packagingRisk];
  if (e.offlineSupport) s -= 0.5;
  return s;
}

/**
 * 对三候选做稳定排序：先按综合风险评分升序，评分相同按候选名升序（确定性 tie-break）。
 * 返回完整评估数组，索引 0 为最推荐。
 */
export function rankRealTtsProviders(): RealTtsProviderEvaluation[] {
  const all: RealTtsProviderEvaluation[] = [
    evaluateRealTtsProvider("edge"),
    evaluateRealTtsProvider("kokoro"),
    evaluateRealTtsProvider("piper"),
  ];
  return all.slice().sort((a, b) => {
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sa !== sb) return sa - sb;
    return a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0;
  });
}

/**
 * 推荐下一步接入的候选（取排序首位）。
 * 当前数据下 kokoro 与 piper 同为本地/MIT/离线，kokoro 凭确定性 tie-break 居首；
 * 实际 Day13C spike 应以"本地依赖可得性 + 中文音色验证"为准，可能翻转到 piper。
 */
export function recommendNextProvider(): RealTtsProviderCandidate {
  return rankRealTtsProviders()[0].candidate;
}
