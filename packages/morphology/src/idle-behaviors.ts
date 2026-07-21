// ============================================================
// @avatar-os/morphology — 随机行为树 (Random Behavior Tree)
// ============================================================
// 从 desktop-pet-liveliness SKILL 迁移的"空闲微动作"能力：
//   萌物在无人交互 10~30s 后，随机挑选一个空闲小动作(歪头/张望/挠头/
//   打哈欠/伸懒腰/弹跳/困倦摇摆/扭动)，播放期间同步冒一个"想法气泡"。
//
// 设计铁律(与 limbs 一致)：
//   - 纯函数，不依赖 DOM / React，便于单测与未来扩展。
//   - 仅产出"姿态描述"(LimbAngles + 头部倾斜 + 整体浮动)，由渲染层消费。
//   - 随机性外置(rng 参数)，测试可注入确定性种子。
//
// 坐标约定：复用 limb-kinematics 的 SVG 120x155 体系，旋转角以"度"为单位，
// 正角 = 顺时针(因 y 向下)，0 = 静息。

import { LimbAngles, REST_LIMB_ANGLES } from "./limb-kinematics";

/** 8 种空闲微动作类型（与 SKILL 的随机行为树一一对应） */
export type IdleBehaviorType =
  | "LOOK_AROUND" // 左右张望
  | "SCRATCH_HEAD" // 抓头
  | "YAWN" // 打哈欠
  | "STRETCH" // 伸懒腰
  | "HAPPY_BOUNCE" // 开心弹跳
  | "SLEEPY_SWAY" // 困倦摇摆
  | "HEAD_TILT" // 歪头卖萌
  | "WIGGLE"; // 扭动

export interface ThoughtContent {
  emoji: string;
  text: string;
}

export interface IdleBehaviorDef {
  type: IdleBehaviorType;
  /** 动作持续时间(ms)，行为树与渲染需保持一致 */
  durationMs: number;
  /** 触发时同步冒出的想法气泡 */
  thought: ThoughtContent;
  /**
   * 肢体姿态：由进度 progress∈[0,1] 与时间 t(ms) 推导。
   * progress 用于"入场/出场"包络，t 用于内部连续振荡(摆动手感)。
   */
  pose: (progress: number, tMs: number) => LimbAngles;
  /** 整体头部/身体倾斜(度)，叠加在基础呼吸之上，缺省 0 */
  tilt?: (progress: number, tMs: number) => number;
  /** 整体上下浮动(px)，用于弹跳/扭动，缺省 0 */
  bob?: (progress: number, tMs: number) => number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// 入场/出场包络：1 在中间、0 在两端(sin 形)，让动作柔和起止
const envelope = (progress: number): number => Math.sin(clamp01(progress) * Math.PI);

export const IDLE_BEHAVIORS: Record<IdleBehaviorType, IdleBehaviorDef> = {
  // 左右张望：身体小幅左右摆，手臂静息
  LOOK_AROUND: {
    type: "LOOK_AROUND",
    durationMs: 3000,
    thought: { emoji: "👀", text: "看看周围~" },
    pose: () => ({ ...REST_LIMB_ANGLES }),
    tilt: (p) => Math.sin(clamp01(p) * Math.PI * 2) * 9,
  },

  // 抓头：左臂抬到头侧挠(复用 scratchHead 语义)
  SCRATCH_HEAD: {
    type: "SCRATCH_HEAD",
    durationMs: 2600,
    thought: { emoji: "🤔", text: "在想什么呢" },
    pose: (_p, t) => ({
      armL: -150 + Math.sin(t / 600) * 8,
      armR: 0,
      legL: 0,
      legR: 0,
    }),
  },

  // 打哈欠：双臂随包络上抬再落下，身体微沉
  YAWN: {
    type: "YAWN",
    durationMs: 2800,
    thought: { emoji: "🥱", text: "哈啊~" },
    pose: (p) => {
      const raise = envelope(p) * 70;
      return { armL: -raise, armR: raise, legL: 0, legR: 0 };
    },
    bob: (p) => -envelope(p) * 3,
  },

  // 伸懒腰：双臂高高舒展，带轻微呼吸式振荡
  STRETCH: {
    type: "STRETCH",
    durationMs: 2500,
    thought: { emoji: "🙆", text: "伸个懒腰~" },
    pose: (_p, t) => ({
      armL: -155 + Math.sin(t / 500) * 5,
      armR: 155 - Math.sin(t / 500) * 5,
      legL: 0,
      legR: 0,
    }),
  },

  // 开心弹跳：双臂欢呼 + 整体上下蹦
  HAPPY_BOUNCE: {
    type: "HAPPY_BOUNCE",
    durationMs: 2200,
    thought: { emoji: "🥳", text: "好开心！" },
    pose: () => ({ armL: -150, armR: 150, legL: 0, legR: 0 }),
    bob: (p) => Math.abs(Math.sin(clamp01(p) * Math.PI * 2)) * 10,
  },

  // 困倦摇摆：身体缓慢单边摇摆 + 微沉，手臂略耷拉
  SLEEPY_SWAY: {
    type: "SLEEPY_SWAY",
    durationMs: 3200,
    thought: { emoji: "😪", text: "困了…" },
    pose: () => ({ armL: 10, armR: -10, legL: 0, legR: 0 }),
    tilt: (p) => Math.sin(clamp01(p) * Math.PI) * 7,
    bob: () => 2,
  },

  // 歪头卖萌：头部向一侧轻歪再回正
  HEAD_TILT: {
    type: "HEAD_TILT",
    durationMs: 2000,
    thought: { emoji: "😊", text: "嘿嘿~" },
    pose: () => ({ ...REST_LIMB_ANGLES }),
    tilt: (p) => -14 * envelope(p),
  },

  // 扭动：身体快速左右扭，双臂小幅反向摆动
  WIGGLE: {
    type: "WIGGLE",
    durationMs: 2200,
    thought: { emoji: "💃", text: "扭一扭~" },
    pose: (p) => {
      const s = Math.sin(clamp01(p) * Math.PI * 3) * 10;
      return { armL: s, armR: -s, legL: 0, legR: 0 };
    },
    tilt: (p) => Math.sin(clamp01(p) * Math.PI * 3) * 8,
  },
};

/** 全部空闲行为类型（顺序即 pickIdleBehavior 的索引顺序） */
export const ALL_IDLE_BEHAVIORS: IdleBehaviorType[] = [
  "LOOK_AROUND",
  "SCRATCH_HEAD",
  "YAWN",
  "STRETCH",
  "HAPPY_BOUNCE",
  "SLEEPY_SWAY",
  "HEAD_TILT",
  "WIGGLE",
];

/**
 * 下次触发空闲动作的随机等待时长(ms)：10~30s。
 * rng() 返回 [0,1)，由调用方注入（运行时用 Math.random，测试用种子）。
 */
export function nextIdleDelay(rng: () => number): number {
  return 10_000 + rng() * 20_000;
}

/**
 * 随机挑选一个空闲行为。rng=0 → 首项，rng 趋近 1 → 末项。
 */
export function pickIdleBehavior(rng: () => number): IdleBehaviorType {
  const idx = Math.min(
    ALL_IDLE_BEHAVIORS.length - 1,
    Math.max(0, Math.floor(rng() * ALL_IDLE_BEHAVIORS.length)),
  );
  return ALL_IDLE_BEHAVIORS[idx];
}

export interface IdlePoseResult {
  angles: LimbAngles;
  tilt: number;
  bob: number;
}

/**
 * 在动作播放中的某时刻(elapsedMs)推导完整姿态。
 * progress 超出 [0,1] 会被钳制（动作结束后保持末态，不爆值）。
 */
export function idlePoseAt(
  def: IdleBehaviorDef,
  elapsedMs: number,
  tMs: number,
): IdlePoseResult {
  const progress = clamp01(elapsedMs / def.durationMs);
  return {
    angles: def.pose(progress, tMs),
    tilt: def.tilt ? def.tilt(progress, tMs) : 0,
    bob: def.bob ? def.bob(progress, tMs) : 0,
  };
}
