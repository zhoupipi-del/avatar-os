/**
 * Day14D — Kokoro Output Normalizer
 *
 * 把 kokoro 合成产物（形状未知的 unknown 输出）稳定归一化为统一 PCM 结构：
 *
 *   unknown output -> normalizeKokoroAudioOutput() -> { sampleRate, channels: [Float32Array] }
 *
 * 与 Day14C 的 extractKokoroPcmFromUnknownOutput 的区别：
 * - Day14C 是防御性"尽量掏出一段 Float32Array"的冒烟提取；
 * - Day14D 是正式归一化模块：结构化成功/失败、支持更多输入形状、
 *   带 frameCount / durationMs / sourceShape 元数据，供后续 pipeline 稳定消费。
 *
 * 纯数据变换：不发网络请求、不触发模型下载、不读文件。
 *
 * 红线（本文件不做的）：
 * - 不创建任何运行时音频对象、不连接音频节点
 * - 不接产品语音控制器 / 皮肤组件 / 口型面板
 * - 不写表情 / 不驱动口型
 * - 不使用 node 内置模块、不解码媒体格式
 */

/** 归一化后的统一 PCM 结构。 */
export interface NormalizedKokoroPcm {
  /** 采样率 (Hz) */
  readonly sampleRate: number;
  /** 通道数据（当前恒为单通道 [Float32Array]） */
  readonly channels: ReadonlyArray<Float32Array>;
  /** 单通道采样点数 */
  readonly frameCount: number;
  /** 时长（毫秒） */
  readonly durationMs: number;
  /** 识别到的输入形状标识（调试/断言用） */
  readonly sourceShape: string;
}

/** 归一化结果：成功携带 pcm，失败携带 error（不 throw）。 */
export interface KokoroNormalizeResult {
  readonly ok: boolean;
  readonly pcm: NormalizedKokoroPcm | null;
  readonly error: string | null;
}

export interface KokoroNormalizeOptions {
  /** 输出未携带采样率时的 fallback（默认 24000） */
  readonly fallbackSampleRate?: number;
}

/** kokoro 默认输出采样率。 */
export const KOKORO_DEFAULT_SAMPLE_RATE = 24000;

/** 候选采样率字段名（按优先级）。 */
const SAMPLE_RATE_KEYS = ["sampling_rate", "sampleRate", "sample_rate", "sr"] as const;

/** 候选音频数据字段名（按优先级）。 */
const AUDIO_KEYS = ["audio", "pcm", "data", "samples", "waveform"] as const;

function isFiniteNumberArray(v: unknown): v is ReadonlyArray<number> {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof v[0] === "number"
  );
}

/**
 * 从 unknown 输出中提取采样率。
 * 支持顶层与一层嵌套（如 { audio: { sampling_rate } }）；无法提取时返回 fallback。
 */
export function extractSampleRate(output: unknown, fallback?: number): number {
  const fb =
    Number.isFinite(fallback) && (fallback ?? 0) > 0
      ? fallback!
      : KOKORO_DEFAULT_SAMPLE_RATE;
  if (!output || typeof output !== "object") return fb;
  const obj = output as Record<string, unknown>;

  for (const key of SAMPLE_RATE_KEYS) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  // 一层嵌套：{ audio: { sampling_rate } } 等
  for (const audioKey of AUDIO_KEYS) {
    const inner = obj[audioKey];
    if (inner && typeof inner === "object" && !(inner instanceof Float32Array) && !Array.isArray(inner)) {
      const innerObj = inner as Record<string, unknown>;
      for (const key of SAMPLE_RATE_KEYS) {
        const v = innerObj[key];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      }
    }
  }
  return fb;
}

/**
 * 从 unknown 输出中提取 Float32Array 音频数据（含形状标识）。
 * 支持：
 * - Float32Array 本体
 * - number[]（转换为 Float32Array）
 * - { audio | pcm | data | samples | waveform: Float32Array | number[] }
 * - 一层嵌套：{ audio: { audio: Float32Array } }（RawAudio 包裹形）
 * 提取失败返回 null。
 */
export function extractFloat32Audio(
  output: unknown,
): { readonly audio: Float32Array; readonly shape: string } | null {
  if (output instanceof Float32Array) {
    return output.length > 0 ? { audio: output, shape: "float32-array" } : null;
  }
  if (isFiniteNumberArray(output)) {
    return { audio: new Float32Array(output), shape: "number-array" };
  }
  if (!output || typeof output !== "object") return null;

  const obj = output as Record<string, unknown>;
  for (const key of AUDIO_KEYS) {
    const v = obj[key];
    if (v instanceof Float32Array) {
      return v.length > 0 ? { audio: v, shape: `object.${key}:float32-array` } : null;
    }
    if (isFiniteNumberArray(v)) {
      return { audio: new Float32Array(v), shape: `object.${key}:number-array` };
    }
    // 一层嵌套（RawAudio 包裹形：{ audio: { audio, sampling_rate } }）
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const innerObj = v as Record<string, unknown>;
      for (const innerKey of AUDIO_KEYS) {
        const inner = innerObj[innerKey];
        if (inner instanceof Float32Array) {
          return inner.length > 0
            ? { audio: inner, shape: `object.${key}.${innerKey}:float32-array` }
            : null;
        }
        if (isFiniteNumberArray(inner)) {
          return { audio: new Float32Array(inner), shape: `object.${key}.${innerKey}:number-array` };
        }
      }
    }
  }
  return null;
}

/**
 * 归一化入口：unknown 输出 -> { sampleRate, channels: [Float32Array] }。
 * 无效输出返回结构化失败（ok=false + error），绝不 throw。
 */
export function normalizeKokoroAudioOutput(
  output: unknown,
  options?: KokoroNormalizeOptions,
): KokoroNormalizeResult {
  try {
    if (output === null || output === undefined) {
      return { ok: false, pcm: null, error: "output is null or undefined" };
    }
    const extracted = extractFloat32Audio(output);
    if (!extracted) {
      return {
        ok: false,
        pcm: null,
        error: "no recognizable audio payload (expected Float32Array / number[] / known keys)",
      };
    }
    const sampleRate = extractSampleRate(output, options?.fallbackSampleRate);
    const frameCount = extracted.audio.length;
    const durationMs = (frameCount / sampleRate) * 1000;
    return {
      ok: true,
      pcm: {
        sampleRate,
        channels: [extracted.audio],
        frameCount,
        durationMs,
        sourceShape: extracted.shape,
      },
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      pcm: null,
      error: `normalize failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
