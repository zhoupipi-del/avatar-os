/**
 * AudioLipSyncDriver —— 用实时音频频谱驱动 VRM 嘴型
 *
 * 接入点：CompanionVoice 在播放克隆声音时，通过 WebAudio AnalyserNode 暴露频谱。
 * 本驱动每帧读取频域数据，交给 analyzeFormantViseme 得到 aa/ih/ou/ee/oh 元音权重，
 * 平滑后写入 VRM expressionManager。无音频（系统语音 / 静音）时回落文本节奏口型。
 *
 * 复用 formant-viseme-analyzer（clean-room 共振峰算法）与 LIP_SYNC_MOUTH_SHAPES，
 * 不重复造轮子，也不连接任何音频节点（节点在 CompanionVoice 侧创建）。
 */

import {
  analyzeFormantViseme,
  type MouthShape,
} from "./formant-viseme-analyzer";
import {
  LIP_SYNC_MOUTH_SHAPES,
  type LipSyncExpressionManagerLike,
} from "./lip-sync-expression-writer";

export interface AudioLipSyncOptions {
  readonly enabled?: boolean;
  readonly cap?: number;
  readonly attack?: number;
  readonly release?: number;
}

const DEFAULT_CAP = 0.85;
const DEFAULT_ATTACK = 60;
const DEFAULT_RELEASE = 35;

export class AudioLipSyncDriver {
  private enabled: boolean;
  private readonly cap: number;
  private readonly attack: number;
  private readonly release: number;

  private attachedAnalyser: AnalyserNode | null = null;
  private buffer = new Uint8Array(1024);

  private readonly smoothed: Record<MouthShape, number> = {
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
  };

  constructor(options: AudioLipSyncOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.cap = clamp01(options.cap ?? DEFAULT_CAP);
    this.attack = options.attack ?? DEFAULT_ATTACK;
    this.release = options.release ?? DEFAULT_RELEASE;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.resetAll();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 接入一个新的 AnalyserNode（每句话会创建新的 AudioContext / analyser） */
  attach(analyser: AnalyserNode): void {
    if (
      this.attachedAnalyser === analyser &&
      this.buffer.length === analyser.frequencyBinCount
    ) {
      return;
    }
    this.attachedAnalyser = analyser;
    this.buffer = new Uint8Array(analyser.frequencyBinCount);
  }

  /**
   * 每帧调用：读频谱 → 元音权重 → 平滑 → 写 VRM。
   * 返回当前是否处于人声段（用于状态展示）。无 analyser / 未启用 / 静音时归零。
   */
  tick(manager: LipSyncExpressionManagerLike | null, delta = 0.016): boolean {
    const analyser = this.attachedAnalyser;
    if (!analyser || !manager || !this.enabled) {
      this.resetAll(manager);
      return false;
    }

    analyser.getByteFrequencyData(this.buffer);
    const result = analyzeFormantViseme({
      frequencyData: this.buffer,
      sampleRate: analyser.context.sampleRate,
    });

    const target: Record<MouthShape, number> = {
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0,
    };
    if (result.active) {
      for (const shape of LIP_SYNC_MOUTH_SHAPES) {
        target[shape] = Math.min(this.cap, result.weights[shape]);
      }
    }

    const dt = delta > 0 ? delta : 0.016;
    let anyActive = false;
    for (const shape of LIP_SYNC_MOUTH_SHAPES) {
      const from = this.smoothed[shape];
      const to = target[shape];
      const rate = 1 - Math.exp(-(to > from ? this.attack : this.release) * dt);
      const next = from + (to - from) * rate;
      const w = next <= 0.01 ? 0 : next;
      this.smoothed[shape] = w;
      try {
        manager.setValue(shape, w);
      } catch {
        // 某些 VRM 没有该 blendshape，忽略
      }
      if (w > 0.001) anyActive = true;
    }
    return anyActive;
  }

  resetAll(manager?: LipSyncExpressionManagerLike | null): void {
    for (const shape of LIP_SYNC_MOUTH_SHAPES) {
      this.smoothed[shape] = 0;
    }
    if (manager) {
      for (const shape of LIP_SYNC_MOUTH_SHAPES) {
        try {
          manager.setValue(shape, 0);
        } catch {
          // ignore
        }
      }
    }
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
