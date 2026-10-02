/**
 * Day14C — Kokoro Model Load Smoke
 *
 * 目标：kokoro-js → model load → generate short text → inspect audio output
 *       → try extract PCM → feed PcmSpectrumSource/Formant pipeline → produce viseme result
 *
 * 真实模型下载不进普通 gate，用环境变量 AVATAROS_RUN_KOKORO_MODEL_SMOKE 手动开启。
 * 普通测试（无 env var）只验配置/结构/离线逻辑；真实 smoke 需手动设置 env var 后运行。
 *
 * 与 Day14A/B 的关系：
 * - Day14A 用动态 import 探测（未安装时 graceful fallback），真实合成路径已就位但未实际安装包。
 * - Day14B 真安装 kokoro-js@1.2.1，验证四道基础闸门兼容，禁用 from_pretrained。
 * - Day14C（本步）才允许 from_pretrained / generate 真实合成 + 接 formant pipeline。
 *
 * 红线（不做的）：
 * - 不接产品 runtime、不驱动 VOID 嘴型
 * - 不创建音频上下文 / 不创建音频节点
 * - 不改既有产品语音控制器 / 皮肤组件 / 口型面板
 * - 不写 expression / 不驱动口型
 */

import { PcmSpectrumSource } from "./pcm-spectrum-source";
import { FormantVisemeRuntimeProbe } from "./formant-viseme-runtime-probe";
import type { FormantVisemeResult } from "./formant-viseme-analyzer";
import type { AudioSpectrumSource } from "./audio-spectrum-source";

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 环境变量名：设为 "1"/"true"/"yes" 时才允许真实模型加载。 */
const SMOKE_ENV_VAR = "AVATAROS_RUN_KOKORO_MODEL_SMOKE";

/** Hugging Face 模型 ID（kokoro 82M 参数模型）。 */
const SMOKE_MODEL_ID = "onnx-community/Kokoro-82M-v1.0";

/** 默认音色（美式女声）。 */
const SMOKE_DEFAULT_VOICE = "af_heart";

/** 默认合成文本。 */
const SMOKE_DEFAULT_TEXT = "Hello, this is a test.";

/** 模型量化精度（q8 = 8-bit 量化，体积最小）。 */
const SMOKE_DTYPE = "q8" as const;

/** kokoro-js 包 specifier（变量，动态 import 探测用）。 */
const SMOKE_SPECIFIER = "kokoro-js";

/** 安装兼容性元数据。 */
export interface KokoroModelSmokeConfig {
  readonly envVarName: string;
  readonly modelId: string;
  readonly defaultVoice: string;
  readonly defaultText: string;
  readonly dtype: "q8";
  readonly modelLoadPolicy: "env-gated-day14c";
}

/**
 * 返回 Day14C 模型加载冒烟的静态配置。
 * 纯静态声明，不触发任何 import / 网络 / 模型加载。
 */
export function getKokoroModelSmokeConfig(): KokoroModelSmokeConfig {
  return {
    envVarName: SMOKE_ENV_VAR,
    modelId: SMOKE_MODEL_ID,
    defaultVoice: SMOKE_DEFAULT_VOICE,
    defaultText: SMOKE_DEFAULT_TEXT,
    dtype: SMOKE_DTYPE,
    modelLoadPolicy: "env-gated-day14c",
  };
}

// ---------------------------------------------------------------------------
// 环境门控
// ---------------------------------------------------------------------------

/**
 * 安全读取环境变量（兼容 node/vitest 与浏览器环境）。
 * 在浏览器中 process 不存在，返回 undefined。
 */
function readSmokeEnvVar(): string | undefined {
  try {
    const g = globalThis as Record<string, unknown>;
    const p = g.process as { env?: Record<string, string | undefined> } | undefined;
    if (p && p.env) {
      const v = p.env[SMOKE_ENV_VAR];
      if (v !== undefined) return v;
    }
  } catch {
    // ignore — 浏览器环境无 process
  }
  return undefined;
}

/**
 * 判断是否应运行真实模型加载冒烟。
 * 仅当环境变量 AVATAROS_RUN_KOKORO_MODEL_SMOKE 设为 "1"/"true"/"yes" 时返回 true。
 * 普通测试 / CI 不设此变量 → 返回 false → 不下载模型、不真实合成。
 */
export function shouldRunKokoroModelSmoke(): boolean {
  const v = readSmokeEnvVar();
  if (!v) return false;
  const lower = v.toLowerCase().trim();
  return lower === "1" || lower === "true" || lower === "yes";
}

// ---------------------------------------------------------------------------
// 模块加载与检查
// ---------------------------------------------------------------------------

/** 模块检查结果。 */
export interface KokoroModuleInspection {
  readonly available: boolean;
  readonly hasKokoroTTS: boolean;
  readonly exportedKeys: string[];
  readonly KokoroTTSConstructor: unknown | null;
}

let smokeModuleCache: Record<string, any> | null = null;
let smokeModuleProbeDone = false;

/**
 * 动态加载 kokoro-js 模块（供 smoke 使用）。
 * 用变量 specifier + @vite-ignore，使 tsc / vite 不静态解析、不把 kokoro-js 打进产物。
 * 包未安装时返回 null。
 */
export async function loadKokoroModuleForSmoke(): Promise<Record<string, any> | null> {
  if (smokeModuleProbeDone) return smokeModuleCache;
  smokeModuleProbeDone = true;
  try {
    const mod = await import(/* @vite-ignore */ SMOKE_SPECIFIER as string);
    smokeModuleCache = (mod && (mod as Record<string, any>).default
      ? (mod as any).default
      : mod) ?? null;
  } catch {
    smokeModuleCache = null;
  }
  return smokeModuleCache;
}

/**
 * 检查已加载的模块，提取 KokoroTTS 构造器信息。
 * 纯同步函数，不触发任何网络 / 模型加载。
 */
export function inspectKokoroModule(mod: Record<string, any> | null): KokoroModuleInspection {
  if (!mod) {
    return { available: false, hasKokoroTTS: false, exportedKeys: [], KokoroTTSConstructor: null };
  }
  const exportedKeys = Object.keys(mod);
  const KokoroTTSConstructor =
    mod.KokoroTTS ?? (mod.default && mod.default.KokoroTTS) ?? null;
  return {
    available: true,
    hasKokoroTTS: !!KokoroTTSConstructor,
    exportedKeys,
    KokoroTTSConstructor,
  };
}

// ---------------------------------------------------------------------------
// 真实模型加载冒烟
// ---------------------------------------------------------------------------

/** 冒烟输出结果。 */
export interface KokoroSmokeOutput {
  readonly text: string;
  readonly rawOutput: unknown;
  readonly pcm: { readonly sampleRate: number; readonly channels: ReadonlyArray<Float32Array> } | null;
  readonly inspection: KokoroModuleInspection;
  readonly error?: string;
}

/**
 * 运行真实模型加载 + 合成冒烟。
 *
 * 流程：loadKokoroModuleForSmoke → inspectKokoroModule →
 *       KokoroTTS.from_pretrained(model_id, {dtype}) → model.generate(text, {voice}) →
 *       extractKokoroPcmFromUnknownOutput → 返回结果
 *
 * 任何一步失败都不抛异常，而是在返回值的 error 字段中描述原因。
 * 调用方应先用 shouldRunKokoroModelSmoke() 判断是否允许运行。
 */
export async function runKokoroModelLoadSmoke(
  text?: string,
  options?: { voice?: string; dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16" },
): Promise<KokoroSmokeOutput> {
  const config = getKokoroModelSmokeConfig();
  const speakText = text || config.defaultText;
  const voice = options?.voice || config.defaultVoice;
  const dtype = options?.dtype || config.dtype;

  const mod = await loadKokoroModuleForSmoke();
  const inspection = inspectKokoroModule(mod);

  if (!inspection.hasKokoroTTS || !inspection.KokoroTTSConstructor) {
    return {
      text: speakText,
      rawOutput: null,
      pcm: null,
      inspection,
      error: "KokoroTTS constructor not found in module",
    };
  }

  try {
    const KokoroTTS = inspection.KokoroTTSConstructor as {
      from_pretrained(modelId: string, opts: { dtype: string }): Promise<any>;
    };
    const model = await KokoroTTS.from_pretrained(config.modelId, { dtype });
    const audio = await model.generate(speakText, { voice });
    const pcm = extractKokoroPcmFromUnknownOutput(audio);
    return {
      text: speakText,
      rawOutput: audio,
      pcm,
      inspection,
    };
  } catch (err) {
    return {
      text: speakText,
      rawOutput: null,
      pcm: null,
      inspection,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// PCM 提取（防御性）
// ---------------------------------------------------------------------------

/** 提取出的 PCM 数据结构。 */
export interface ExtractedPcm {
  readonly sampleRate: number;
  readonly channels: ReadonlyArray<Float32Array>;
}

/**
 * 从 kokoro generate() 的未知输出结构中防御性提取 PCM 数据。
 *
 * kokoro-js 的 generate() 返回 RawAudio（来自 @huggingface/transformers），
 * 标准结构为 { audio: Float32Array, sampling_rate: number }。
 * 但不同版本 / 运行时可能有不同字段名，本函数尝试多种可能：
 *
 * 音频数据字段：audio / pcm / data / samples / waveform
 * 采样率字段：sampling_rate / sampleRate / sr / sample_rate
 *
 * 无法提取时返回 null（不抛异常）。
 */
export function extractKokoroPcmFromUnknownOutput(output: unknown): ExtractedPcm | null {
  if (!output || typeof output !== "object") return null;
  const obj = output as Record<string, any>;

  // 尝试常见的音频数据字段名
  const audioFields = ["audio", "pcm", "data", "samples", "waveform"];
  let pcmData: Float32Array | null = null;

  for (const field of audioFields) {
    const val = obj[field];
    if (val instanceof Float32Array && val.length > 0) {
      pcmData = val;
      break;
    }
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === "number") {
      pcmData = new Float32Array(val);
      break;
    }
  }

  if (!pcmData) return null;

  // 尝试常见的采样率字段名
  const srFields = ["sampling_rate", "sampleRate", "sr", "sample_rate"];
  let sampleRate = 24000;
  for (const field of srFields) {
    const val = obj[field];
    if (typeof val === "number" && val > 0 && Number.isFinite(val)) {
      sampleRate = val;
      break;
    }
  }

  return { sampleRate, channels: [pcmData] as ReadonlyArray<Float32Array> };
}

// ---------------------------------------------------------------------------
// PCM → Formant 分析
// ---------------------------------------------------------------------------

/** 冒烟分析结果。 */
export interface KokoroSmokeAnalysisResult {
  readonly pcm: ExtractedPcm | null;
  readonly results: FormantVisemeResult[];
  readonly activeCount: number;
  readonly reasons: string[];
  readonly frameCount: number;
}

/**
 * 把 PCM 数据喂给 PcmSpectrumSource → FormantVisemeRuntimeProbe → 逐帧分析。
 *
 * 流程：PcmSpectrumSource(pcm) → FormantVisemeRuntimeProbe → update() x frameCount → 聚合
 *
 * PCM 为 null / 空 / 构造失败时返回空结果（不抛异常）。
 */
export function analyzeKokoroPcmSmoke(
  pcm: ExtractedPcm | null,
  frameCount?: number,
): KokoroSmokeAnalysisResult {
  const frames =
    Number.isFinite(frameCount) && (frameCount ?? 0) > 0
      ? Math.floor(frameCount!)
      : 10;

  if (!pcm || !pcm.channels || pcm.channels.length === 0) {
    return { pcm, results: [], activeCount: 0, reasons: [], frameCount: 0 };
  }

  const channelData = pcm.channels[0];
  if (!channelData || channelData.length === 0) {
    return { pcm, results: [], activeCount: 0, reasons: [], frameCount: 0 };
  }

  let source: AudioSpectrumSource;
  try {
    source = new PcmSpectrumSource({
      sampleRate: pcm.sampleRate,
      channelData,
    });
  } catch {
    return { pcm, results: [], activeCount: 0, reasons: [], frameCount: 0 };
  }

  const probe = new FormantVisemeRuntimeProbe(source);
  const results: FormantVisemeResult[] = [];
  const reasons = new Set<string>();

  for (let i = 0; i < frames; i++) {
    const r = probe.update();
    if (r) {
      results.push(r);
      reasons.add(r.reason);
    }
  }

  return {
    pcm,
    results,
    activeCount: results.filter((r) => r.active).length,
    reasons: Array.from(reasons),
    frameCount: frames,
  };
}
