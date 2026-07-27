/**
 * Formant Viseme Analyzer —— 纯算法 clean-room 重写
 *
 * 输入：频域数据 (Uint8Array，结构等价于 getByteFrequencyData 的输出) + 采样率
 * 输出：aa / ih / ou / ee / oh 的口型权重
 *
 * 思路源自共振峰 (F1/F2) 元音分类：用频域峰值坐标把声音映射到元音三角。
 * 这里只重写算法骨架，不依赖任何运行时音频对象、不连接音频节点、不写表情。
 */

export type MouthShape = "aa" | "ih" | "ou" | "ee" | "oh";

export const MOUTH_SHAPES: readonly MouthShape[] = ["aa", "ih", "ou", "ee", "oh"] as const;

export interface FormantPeak {
  /** 峰值频率 (Hz) */
  freq: number;
  /** 峰值幅度 (0~255) */
  amp: number;
}

export interface FormantVisemeWeights {
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
}

export interface FormantVisemeResult {
  /** 是否处于有效人声段（非静音 / 非低能量） */
  active: boolean;
  /** 归一化强度 0~1 */
  intensity: number;
  /** 第一共振峰频率 (Hz) */
  f1: number;
  /** 第二共振峰频率 (Hz) */
  f2: number;
  /** 人声频段平均能量 0~255 */
  vocalEnergy: number;
  weights: FormantVisemeWeights;
  /** 触发该结果的分类原因，便于调试 */
  reason: string;
}

export interface FormantAnalyzerInput {
  /** 频域幅度数组 (0~255) */
  frequencyData: Uint8Array;
  /** 采样率 (Hz) */
  sampleRate: number;
  /** 底噪门限，默认 15；低于此平均能量视为静音 */
  noiseGate?: number;
}

// 共振峰搜索区间（人声元音统计范围）
const F1_MIN = 200;
const F1_MAX = 1000;
const F2_MIN = 1000;
const F2_MAX = 3000;
const VOCAL_MIN = 200;
const VOCAL_MAX = 4000;

// 分类阈值
const F1_HIGH_THRESHOLD = 500;
const F1_LOW_THRESHOLD = 350;
const F2_HIGH_THRESHOLD = 1500;
const DEFAULT_NOISE_GATE = 15;
const SENSITIVITY = 1.0;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function safeRange(minFreq: number, maxFreq: number, sampleRate: number, binCount: number): [number, number] {
  const nyquist = sampleRate / 2;
  const start = Math.max(0, Math.min(binCount - 1, Math.floor((minFreq / nyquist) * binCount)));
  const end = Math.max(0, Math.min(binCount - 1, Math.floor((maxFreq / nyquist) * binCount)));
  return [start, end];
}

/**
 * 在指定频率区间内寻找最强频点，返回其频率与幅度。
 */
export function findPeakInRange(
  frequencyData: Uint8Array,
  sampleRate: number,
  minFreq: number,
  maxFreq: number,
): FormantPeak {
  const binCount = frequencyData.length;
  const [start, end] = safeRange(minFreq, maxFreq, sampleRate, binCount);
  let maxAmp = -Infinity;
  let maxIndex = -1;
  for (let i = start; i <= end; i++) {
    if (frequencyData[i] > maxAmp) {
      maxAmp = frequencyData[i];
      maxIndex = i;
    }
  }
  if (maxIndex < 0 || maxAmp < 0) {
    return { freq: 0, amp: 0 };
  }
  const nyquist = sampleRate / 2;
  return { freq: (maxIndex / binCount) * nyquist, amp: maxAmp };
}

/**
 * 计算指定频率区间内的平均能量（0~255）。
 */
export function computeVocalEnergy(
  frequencyData: Uint8Array,
  sampleRate: number,
  minFreq: number,
  maxFreq: number,
): number {
  const binCount = frequencyData.length;
  const [start, end] = safeRange(minFreq, maxFreq, sampleRate, binCount);
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i <= end; i++) {
    sum += frequencyData[i];
  }
  return sum / (end - start);
}

/**
 * 纯算法入口：频域数据 → 元音口型权重。
 *
 * 分类规则（优先级自上而下）：
 *  1. 静音 / 低能量 → inactive，全 0
 *  2. F1 高 → aa（大张嘴）
 *  3. F1 低 + F2 高 → ih（带少量 ee）
 *  4. F1 低 + F2 低 → ou
 *  5. F2 高（F1 居中）→ ee（带少量 ih）
 *  6. 其余兜底 → oh（带少量 ou）
 */
export function analyzeFormantViseme(input: FormantAnalyzerInput): FormantVisemeResult {
  const empty: FormantVisemeResult = {
    active: false,
    intensity: 0,
    f1: 0,
    f2: 0,
    vocalEnergy: 0,
    weights: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
    reason: "invalid-input",
  };

  if (
    !input ||
    !(input.frequencyData instanceof Uint8Array) ||
    input.frequencyData.length === 0 ||
    !Number.isFinite(input.sampleRate) ||
    input.sampleRate <= 0
  ) {
    return empty;
  }

  const noiseGate = Number.isFinite(input.noiseGate) ? input.noiseGate! : DEFAULT_NOISE_GATE;
  const f1 = findPeakInRange(input.frequencyData, input.sampleRate, F1_MIN, F1_MAX);
  const f2 = findPeakInRange(input.frequencyData, input.sampleRate, F2_MIN, F2_MAX);
  const vocalEnergy = computeVocalEnergy(input.frequencyData, input.sampleRate, VOCAL_MIN, VOCAL_MAX);

  const weights: FormantVisemeWeights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

  if (vocalEnergy <= noiseGate) {
    return {
      active: false,
      intensity: 0,
      f1: f1.freq,
      f2: f2.freq,
      vocalEnergy,
      weights,
      reason: "silence-or-low-energy",
    };
  }

  const intensity = clamp01((vocalEnergy / 255) * SENSITIVITY);
  let reason = "fallback-oh";

  if (f1.freq > F1_HIGH_THRESHOLD) {
    weights.aa = intensity;
    reason = "f1-high-aa";
  } else if (f1.freq < F1_LOW_THRESHOLD) {
    if (f2.freq > F2_HIGH_THRESHOLD) {
      weights.ih = intensity;
      weights.ee = intensity * 0.3;
      reason = "f1-low-f2-high-ih";
    } else {
      weights.ou = intensity;
      reason = "f1-low-f2-low-ou";
    }
  } else {
    if (f2.freq > F2_HIGH_THRESHOLD) {
      weights.ee = intensity;
      weights.ih = intensity * 0.2;
      reason = "f2-high-ee";
    } else {
      weights.oh = intensity;
      weights.ou = intensity * 0.3;
      reason = "fallback-oh";
    }
  }

  for (const k of MOUTH_SHAPES) {
    weights[k] = clamp01(weights[k]);
  }

  return {
    active: true,
    intensity,
    f1: f1.freq,
    f2: f2.freq,
    vocalEnergy,
    weights,
    reason,
  };
}
