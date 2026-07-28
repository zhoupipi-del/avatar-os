/**
 * Day13C — PCM Spectrum Source
 *
 * 把时域 PCM 采样转换为频域幅度数据(0~255)，实现 Day11C 的 AudioSpectrumSource。
 * 用于 Local PCM Fixture TTS Provider 的测试闭环：
 *
 *   PCM samples -> Hann window -> radix-2 FFT -> magnitude -> dB -> 0~255
 *
 * 纯 TypeScript 实现，不依赖浏览器音频 API、不创建音频上下文、不连接音频节点。
 * FFT 为标准迭代式 Cooley-Tukey radix-2 实现。
 *
 * 红线（本文件不做的）：
 * - 不创建任何运行时音频对象、不连接音频节点、不接真实 TTS 引擎
 * - 不读文件（不使用 node 内置模块）、不解码媒体格式
 * - 不驱动表情、不接 VRM / runtime
 * - 数据全部来自调用方传入的 PCM 数组（合成或 fixture），与真实声音无关
 */

import type { AudioSpectrumSource } from "./audio-spectrum-source";

// ---------------------------------------------------------------------------
// 纯 TS radix-2 FFT（Cooley-Tukey 迭代式）
// ---------------------------------------------------------------------------

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * 原地迭代式 radix-2 FFT。
 * re / im 长度必须相等且为 2 的幂。
 * 输出：re[k] + i*im[k] = X[k]（DFT 结果）。
 */
function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Butterfly operations
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < half; j++) {
        const aRe = re[i + j];
        const aIm = im[i + j];
        const bRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
        const bIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
        re[i + j] = aRe + bRe;
        im[i + j] = aIm + bIm;
        re[i + j + half] = aRe - bRe;
        im[i + j + half] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** 对 data 施加 Hann 窗，结果写入 out（两者长度须相等）。 */
function applyHann(data: Float32Array, out: Float32Array): void {
  const n = data.length;
  if (n <= 1) {
    out[0] = data[0];
    return;
  }
  for (let i = 0; i < n; i++) {
    out[i] = data[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
}

/** FFT 幅度 -> 0~255 字节（dB 标度，映射 [-60, 0] dB -> [0, 255]）。 */
function magnitudeToByte(magnitude: number, fftSize: number): number {
  const normalized = magnitude / (fftSize / 2);
  if (normalized < 1e-7) return 0;
  const db = 20 * Math.log10(normalized);
  const val = Math.round(((db + 60) / 60) * 255);
  return val < 0 ? 0 : val > 255 ? 255 : val;
}

// ---------------------------------------------------------------------------
// PcmSpectrumSource
// ---------------------------------------------------------------------------

export interface PcmSpectrumSourceOptions {
  /** 采样率 (Hz) */
  readonly sampleRate: number;
  /** PCM 采样数据（单声道，Float32 或普通数组） */
  readonly channelData: readonly number[] | Float32Array;
  /** FFT 窗口大小，必须为 2 的幂，默认 1024 */
  readonly frameSize?: number;
}

/** 频谱底噪：active 帧的 bin 最低值，保证 vocalEnergy 高于 analyzer 默认 noiseGate(15)。 */
const SPECTRAL_FLOOR = 30;

/** 判定帧是否有信号的阈值（最大采样绝对值低于此值视为静音帧）。 */
const SIGNAL_THRESHOLD = 1e-6;

/**
 * PCM -> 频谱 源：从 PCM 采样数据逐帧计算频域幅度(0~255)。
 *
 * 每次 getFrequencyData() 取当前窗口(frameSize 个采样)做 Hann + FFT，
 * 输出前 frameSize/2 个 bin 的幅度，然后游标前移 frameSize。
 * 到 PCM 尾部后返回全 0（静音），不再循环。
 *
 * 实现 Day11C 的 AudioSpectrumSource，不创建任何音频对象。
 */
export class PcmSpectrumSource implements AudioSpectrumSource {
  readonly sampleRate: number;
  readonly frequencyBinCount: number;
  private readonly channelData: Float32Array;
  private readonly frameSize: number;
  private cursor = 0;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly windowed: Float32Array;
  private readonly outputBuffer: Uint8Array;

  constructor(opts: PcmSpectrumSourceOptions) {
    if (!opts || !Number.isFinite(opts.sampleRate) || opts.sampleRate <= 0) {
      throw new Error("PcmSpectrumSource: sampleRate must be a positive number");
    }
    this.sampleRate = opts.sampleRate;

    const data = opts.channelData ?? [];
    this.channelData = data instanceof Float32Array ? data : new Float32Array(data);

    const fs =
      Number.isFinite(opts.frameSize) && (opts.frameSize ?? 0) > 0
        ? Math.floor(opts.frameSize!)
        : 1024;
    if (!isPowerOfTwo(fs)) {
      throw new Error(`PcmSpectrumSource: frameSize must be a power of 2, got ${fs}`);
    }
    this.frameSize = fs;
    this.frequencyBinCount = fs >> 1;

    this.re = new Float32Array(fs);
    this.im = new Float32Array(fs);
    this.windowed = new Float32Array(fs);
    this.outputBuffer = new Uint8Array(this.frequencyBinCount);
  }

  /** 当前游标位置（下次 getFrequencyData 将分析的起始采样序号）。 */
  getCursor(): number {
    return this.cursor;
  }

  /** 重置游标到 0。 */
  resetCursor(): void {
    this.cursor = 0;
  }

  getFrequencyData(): Uint8Array {
    const remaining = this.channelData.length - this.cursor;

    // 到尾部：返回全 0 静音
    if (remaining < this.frameSize) {
      this.outputBuffer.fill(0);
      return new Uint8Array(this.outputBuffer);
    }

    // 1. 取当前窗口并检测信号
    let maxAbs = 0;
    for (let i = 0; i < this.frameSize; i++) {
      const s = this.channelData[this.cursor + i];
      this.windowed[i] = s;
      const a = s < 0 ? -s : s;
      if (a > maxAbs) maxAbs = a;
    }

    if (maxAbs < SIGNAL_THRESHOLD) {
      // 静音帧
      this.cursor += this.frameSize;
      this.outputBuffer.fill(0);
      return new Uint8Array(this.outputBuffer);
    }

    // 2. Hann 窗（直接写入 re，im 后面清零）
    applyHann(this.windowed, this.re);
    this.im.fill(0);

    // 3. FFT
    fftRadix2(this.re, this.im);

    // 4. 幅度 -> 0~255
    for (let i = 0; i < this.frequencyBinCount; i++) {
      const mag = Math.sqrt(this.re[i] * this.re[i] + this.im[i] * this.im[i]);
      this.outputBuffer[i] = magnitudeToByte(mag, this.frameSize);
    }

    // 5. 频谱底噪：active 帧铺一层 floor，保证 vocalEnergy > analyzer noiseGate
    for (let i = 0; i < this.frequencyBinCount; i++) {
      if (this.outputBuffer[i] < SPECTRAL_FLOOR) {
        this.outputBuffer[i] = SPECTRAL_FLOOR;
      }
    }

    // 6. 推进游标
    this.cursor += this.frameSize;

    return new Uint8Array(this.outputBuffer);
  }
}

// ---------------------------------------------------------------------------
// 合成元音 PCM
// ---------------------------------------------------------------------------

export interface SyntheticVowelOptions {
  /** 基频 (Hz)，默认 150 */
  readonly f0?: number;
  /** F1 共振峰带宽 (Hz)，默认 200 */
  readonly f1Bandwidth?: number;
  /** F2 共振峰带宽 (Hz)，默认 300 */
  readonly f2Bandwidth?: number;
}

/**
 * 用 f1/f2 共振峰模型合成元音 PCM。
 *
 * 原理：基频 f0 产生谐波序列，每个谐波的幅度由两个共振峰共振曲线之和决定：
 *   amplitude(h) = R(f, f1, bw1) + R(f, f2, bw2)
 *   R(f, center, bw) = 1 / (1 + ((f - center) / bw)^2)
 *
 * 纯数学合成，不读文件、不解码媒体、不创建音频对象。
 * 产物是一段 Float32Array PCM，可直接喂给 PcmSpectrumSource。
 */
export function buildSyntheticVowelPcm(
  sampleRate: number,
  durationMs: number,
  f1: number,
  f2: number,
  options?: SyntheticVowelOptions,
): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("buildSyntheticVowelPcm: sampleRate must be a positive number");
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("buildSyntheticVowelPcm: durationMs must be a positive number");
  }

  const f0 =
    Number.isFinite(options?.f0) && (options?.f0 ?? 0) > 0 ? options!.f0! : 150;
  const bw1 =
    Number.isFinite(options?.f1Bandwidth) && (options?.f1Bandwidth ?? 0) > 0
      ? options!.f1Bandwidth!
      : 200;
  const bw2 =
    Number.isFinite(options?.f2Bandwidth) && (options?.f2Bandwidth ?? 0) > 0
      ? options!.f2Bandwidth!
      : 300;

  const numSamples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const pcm = new Float32Array(numSamples);
  const nyquist = sampleRate / 2;

  // 预计算谐波频率与幅度
  const harmonics: Array<{ freq: number; amp: number }> = [];
  for (let h = 1; f0 * h < nyquist; h++) {
    const freq = f0 * h;
    const r1 = 1 / (1 + Math.pow((freq - f1) / bw1, 2));
    const r2 = 1 / (1 + Math.pow((freq - f2) / bw2, 2));
    harmonics.push({ freq, amp: r1 + r2 });
  }

  // 合成
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (let j = 0; j < harmonics.length; j++) {
      sample += harmonics[j].amp * Math.sin(2 * Math.PI * harmonics[j].freq * t);
    }
    pcm[i] = sample;
  }

  // 归一化到 0.9
  let maxAbs = 0;
  for (let i = 0; i < numSamples; i++) {
    const a = pcm[i] < 0 ? -pcm[i] : pcm[i];
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs > 0) {
    const scale = 0.9 / maxAbs;
    for (let i = 0; i < numSamples; i++) {
      pcm[i] *= scale;
    }
  }

  return pcm;
}
