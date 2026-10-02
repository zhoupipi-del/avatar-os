/**
 * Day11C — Audio Spectrum Source（频谱源适配层）
 *
 * 目标：把 Day11A 的 AudioTtsProvider（"谁能给可分析音频"）与
 * Day11B 的 formant-viseme-analyzer（"频域数据 → 口型权重"）中间那层补上：
 *
 *   frequencyData source → AudioSpectrumSource → FormantVisemeRuntimeProbe → analyzeFormantViseme()
 *
 * 本层只定义"频谱从哪来"的抽象 + 两个纯数据实现（静态单帧 / 多帧循环）+ 静音源工厂。
 *
 * 红线（本文件不做的）：
 * - 不创建任何运行时音频对象、不连接任何音频节点、不接真实 TTS 引擎
 * - 不驱动表情、不接 VRM / runtime
 * - 数据全部来自调用方传入的静态数组（fixture），与真实声音无关
 */

/**
 * 频谱源抽象：任何能按帧提供频域幅度数据(0~255)与采样率的东西。
 * Day12 的 WebAudio Runtime Bridge 将提供真实实现；本阶段只有纯数据实现。
 */
export interface AudioSpectrumSource {
  /** 采样率 (Hz)，用于 analyzer 把 bin 序号换算为频率 */
  readonly sampleRate: number;
  /** 返回当前帧的频域幅度数组 (0~255)。实现方保证返回 Uint8Array。 */
  getFrequencyData(): Uint8Array;
}

function toUint8Array(data: ArrayLike<number>): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    out[i] = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
  }
  return out;
}

/**
 * 静态单帧频谱源：每次 getFrequencyData 都返回同一帧数据的副本。
 * 用于单测/固定 fixture（如"高 F1 → aa"的构造频谱）。
 */
export class StaticFrequencySpectrumSource implements AudioSpectrumSource {
  readonly sampleRate: number;
  private readonly frame: Uint8Array;

  constructor(frame: ArrayLike<number>, sampleRate: number) {
    this.sampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
    this.frame = toUint8Array(frame ?? []);
  }

  getFrequencyData(): Uint8Array {
    // 返回副本，防止调用方原地修改污染源数据。
    return new Uint8Array(this.frame);
  }
}

/**
 * 多帧循环频谱源：按调用顺序依次返回 frames[0..n-1]，到尾后回绕。
 * 用于模拟"随时间变化的频谱"（如 aa 帧 → 静音帧 → ih 帧 循环）。
 */
export class CyclingFrequencySpectrumSource implements AudioSpectrumSource {
  readonly sampleRate: number;
  private readonly frames: ReadonlyArray<Uint8Array>;
  private cursor = 0;

  constructor(frames: ReadonlyArray<ArrayLike<number>>, sampleRate: number) {
    this.sampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
    const converted = (frames ?? []).map((f) => toUint8Array(f ?? []));
    this.frames = converted.length > 0 ? converted : [new Uint8Array(0)];
  }

  /** 当前游标位置（下一次 getFrequencyData 将返回的帧序号），便于测试断言。 */
  getCursor(): number {
    return this.cursor;
  }

  /** 重置游标到第 0 帧。 */
  resetCursor(): void {
    this.cursor = 0;
  }

  getFrequencyData(): Uint8Array {
    const frame = this.frames[this.cursor];
    this.cursor = (this.cursor + 1) % this.frames.length;
    return new Uint8Array(frame);
  }
}

/**
 * 静音频谱源工厂：全 0 幅度的单帧源。
 * analyzer 对它必然给出 active=false（低于 noiseGate）。
 */
export function createSilentSpectrumSource(
  binCount = 512,
  sampleRate = 44100,
): AudioSpectrumSource {
  const safeBinCount = Number.isFinite(binCount) && binCount > 0 ? Math.floor(binCount) : 512;
  return new StaticFrequencySpectrumSource(new Uint8Array(safeBinCount), sampleRate);
}
