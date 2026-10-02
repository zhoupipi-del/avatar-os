/**
 * Day13D — TTS Dependency Spike（依赖可行性探针，纯评估模块）
 *
 * 对 kokoro / piper 两个本地真实 TTS 候选做"依赖落地可行性"评估，
 * 回答五个核心问题：包能否安装 / 模型如何加载 / 中文能否出声 /
 * 输出能否拿到 PCM 或 buffer / 能否接 Day13C 频谱管线。
 *
 * 本模块是 Day13B（real-tts-provider-decision）的下游细化：
 * Day13B 做三候选（含 edge）的宏观许可证 / 运行时评估，
 * 本模块聚焦 kokoro / piper 两个本地候选的**依赖可行性**，
 * 为 Day14 选一个 provider 做最小实现提供决策依据。
 *
 * 红线（本文件不做的）：
 * - 不 import 任何真实 TTS 包（候选的 npm 包均不引）
 * - 不创建任何音频上下文 / 媒体元素 / 缓冲源
 * - 不写表情、不接 VRM / 皮肤组件 / 语音控制器 / 口型面板
 * - 不修改产品 runtime
 */

/** 依赖探针候选标识（仅 kokoro / piper，edge 本轮不进入）。 */
export type TtsDependencyCandidate = "kokoro" | "piper";

/** 探针状态：true = 已知可行，false = 已知不可行，"unknown" = 待验证。 */
export type TtsDependencyProbeStatus = boolean | "unknown";

/** 风险等级。 */
export type TtsDependencyRisk = "low" | "medium" | "high";

/** 单条候选的依赖可行性探针结论。 */
export interface TtsDependencyProbeResult {
  readonly candidate: TtsDependencyCandidate;
  /** 包能否安装（npm 上是否存在可用包）。 */
  readonly packageAvailable: TtsDependencyProbeStatus;
  /** 能否在浏览器 / Tauri WebView 中运行。 */
  readonly canRunInBrowser: TtsDependencyProbeStatus;
  /** 能否离线运行（模型加载后不依赖网络）。 */
  readonly canRunOffline: TtsDependencyProbeStatus;
  /** 能否输出 PCM 采样（Float32 通道 + sampleRate）。 */
  readonly canOutputPcm: TtsDependencyProbeStatus;
  /** 能否输出可直接使用的音频缓冲。 */
  readonly canOutputAudioBuffer: TtsDependencyProbeStatus;
  /** 是否有可用的中文音色。 */
  readonly hasChineseVoice: TtsDependencyProbeStatus;
  /** 模型打包 / 分发风险（权重体积、格式兼容等）。 */
  readonly modelPackagingRisk: TtsDependencyRisk;
  /** 运行时风险（WASM / WebGPU / 首包加载 / 浏览器兼容等）。 */
  readonly runtimeRisk: TtsDependencyRisk;
  /** 推荐的下一步行动。 */
  readonly recommendedNextAction: string;
  /** 评估备注（含关键权衡与未决项）。 */
  readonly notes: string;
}

const RISK_WEIGHT: Readonly<Record<TtsDependencyRisk, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
});

/**
 * 对单条候选做依赖可行性评估。
 * 数据来源：Day13B 决策结论 + 当前已知外部信息（包存在性、运行形态、输出格式）。
 * 不引入任何外部依赖，纯本地常量；待验证项标记为 "unknown"。
 */
export function evaluateTtsDependencyCandidate(
  candidate: TtsDependencyCandidate,
): TtsDependencyProbeResult {
  switch (candidate) {
    case "kokoro":
      return {
        candidate: "kokoro",
        packageAvailable: true,
        canRunInBrowser: true,
        canRunOffline: true,
        canOutputPcm: "unknown",
        canOutputAudioBuffer: "unknown",
        hasChineseVoice: "unknown",
        modelPackagingRisk: "medium",
        runtimeRisk: "medium",
        recommendedNextAction:
          "以 devDependency 安装 kokoro 包，加载中文音色模型，" +
          "验证 Float32Array PCM 输出，喂入 Day13C 频谱源，" +
          "跑通 Local PCM formant 管线确认口型分类。",
        notes:
          "本地潜力最强：MIT 许可证、浏览器优先设计、有离线运行案例。" +
          "关键未决项：中文音色质量、输出格式（PCM 还是 buffer）、" +
          "模型权重体积对 Tauri 打包的影响。" +
          "运行时走 WASM / WebGPU，首包加载有延迟。",
      };
    case "piper":
      return {
        candidate: "piper",
        packageAvailable: true,
        canRunInBrowser: "unknown",
        canRunOffline: true,
        canOutputPcm: true,
        canOutputAudioBuffer: "unknown",
        hasChineseVoice: "unknown",
        modelPackagingRisk: "high",
        runtimeRisk: "high",
        recommendedNextAction:
          "评估 piper 的浏览器绑定包，测试中文音色模型，" +
          "验证 PCM / WAV 输出路径，对比模型 + wasm + 音素化器的总体积，" +
          "评估 Tauri 打包可行性。",
        notes:
          "离线潜力强：MIT 类许可证，原生输出 PCM / WAV。" +
          "关键未决项：浏览器 / Tauri WebView 兼容性" +
          "（piper 本质是 C++ / ONNX，wasm 端口成熟度待验证）、" +
          "中文音色可得性、音素化器在浏览器中的运行路径。" +
          "打包复杂度高于 kokoro。",
      };
    default: {
      // 穷尽检查：联合类型外不应到达此处。
      const _exhaustive: never = candidate;
      throw new Error(`unknown TTS dependency candidate: ${String(_exhaustive)}`);
    }
  }
}

/** 探针状态转分数（true=0 最优，unknown=1 中等，false=2 最差）。 */
function statusScore(s: TtsDependencyProbeStatus): number {
  if (s === true) return 0;
  if (s === "unknown") return 1;
  return 2;
}

/** 综合评分（越低越优）：风险权重 x2 + 各状态分。 */
function scoreOf(r: TtsDependencyProbeResult): number {
  return (
    RISK_WEIGHT[r.modelPackagingRisk] * 2 +
    RISK_WEIGHT[r.runtimeRisk] * 2 +
    statusScore(r.packageAvailable) +
    statusScore(r.canRunInBrowser) +
    statusScore(r.canRunOffline) +
    statusScore(r.canOutputPcm) +
    statusScore(r.canOutputAudioBuffer) +
    statusScore(r.hasChineseVoice)
  );
}

/**
 * 对两候选做稳定排序：先按综合评分升序，评分相同按候选名升序（确定性 tie-break）。
 * 返回完整评估数组，索引 0 为最推荐。
 */
export function rankTtsDependencyCandidates(): TtsDependencyProbeResult[] {
  const all: TtsDependencyProbeResult[] = [
    evaluateTtsDependencyCandidate("kokoro"),
    evaluateTtsDependencyCandidate("piper"),
  ];
  return all.slice().sort((a, b) => {
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sa !== sb) return sa - sb;
    return a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0;
  });
}

/**
 * 推荐下一步做依赖探针的候选（取排序首位）。
 * 当前数据下 kokoro 凭更低的运行时 / 打包风险与更确定的浏览器支持居首；
 * 实际 Day14 应以"包可安装 + 中文音色可用 + 输出可接管线"的实机验证为准，
 * 可能翻转到 piper。
 */
export function recommendTtsDependencySpike(): TtsDependencyProbeResult {
  return rankTtsDependencyCandidates()[0];
}
