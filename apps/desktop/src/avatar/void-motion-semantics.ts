export type VoidMotionId =
  | "IDLE"
  | "GREET"
  | "GREET_ALT"
  | "BOUNCE_HAPPY"
  | "PEEK"
  | "THINKING"
  | "HAPPY_IDLE"
  | "SAD_BODY";

export type VoidMotionPlayback = "loop" | "once";

export type VoidMotionEnergy =
  | "neutral"
  | "soft"
  | "medium"
  | "high";

export type VoidMotionFocus =
  | "idle"
  | "social"
  | "curious"
  | "thinking"
  | "emotional";

export interface VoidMotionSemantic {
  readonly id: VoidMotionId;

  /**
   * VRMA / AnimationManager 使用的 clip 名。
   * 必须与 VOID_CONFIG / profile 里的动作名保持一致。
   */
  readonly clip: string;

  /**
   * loop：常驻动作，如 IDLE / HAPPY_IDLE
   * once：一次性动作，播完应回 idle
   */
  readonly playback: VoidMotionPlayback;

  /**
   * 表现能量，仅供身体表现层参考。
   * 不参与自主调度，不产生 intent。
   */
  readonly energy: VoidMotionEnergy;

  /**
   * 动作语义聚类，仅供调试和后续校准使用。
   */
  readonly focus: VoidMotionFocus;

  /**
   * 动作期间 LookAt 强度。
   * 1 = 完整追视，0 = 完全不追视。
   * 这是表现层参数，不是 Scheduler 权重。
   */
  readonly gazeScale: number;

  /**
   * once 动作结束后是否必须回 idle。
   */
  readonly returnToIdle: boolean;

  /**
   * 是否要求 root motion 已被归零或抑制。
   * 当前所有 VOID 桌面动作都应为 true。
   */
  readonly requiresInPlace: boolean;
}

export const VOID_MOTION_SEMANTICS = {
  IDLE: {
    id: "IDLE",
    clip: "IDLE",
    playback: "loop",
    energy: "neutral",
    focus: "idle",
    gazeScale: 1,
    returnToIdle: false,
    requiresInPlace: true,
  },

  GREET: {
    id: "GREET",
    clip: "GREET",
    playback: "once",
    energy: "medium",
    focus: "social",
    gazeScale: 0.45,
    returnToIdle: true,
    requiresInPlace: true,
  },

  GREET_ALT: {
    id: "GREET_ALT",
    clip: "GREET_ALT",
    playback: "once",
    energy: "medium",
    focus: "social",
    gazeScale: 0.45,
    returnToIdle: true,
    requiresInPlace: true,
  },

  BOUNCE_HAPPY: {
    id: "BOUNCE_HAPPY",
    clip: "BOUNCE_HAPPY",
    playback: "once",
    energy: "high",
    focus: "emotional",
    gazeScale: 0.25,
    returnToIdle: true,
    requiresInPlace: true,
  },

  PEEK: {
    id: "PEEK",
    clip: "PEEK",
    playback: "once",
    energy: "soft",
    focus: "curious",
    gazeScale: 0.2,
    returnToIdle: true,
    requiresInPlace: true,
  },

  THINKING: {
    id: "THINKING",
    clip: "THINKING",
    playback: "once",
    energy: "soft",
    focus: "thinking",
    gazeScale: 0.55,
    returnToIdle: true,
    requiresInPlace: true,
  },

  HAPPY_IDLE: {
    id: "HAPPY_IDLE",
    clip: "HAPPY_IDLE",
    playback: "loop",
    energy: "medium",
    focus: "emotional",
    gazeScale: 0.75,
    returnToIdle: false,
    requiresInPlace: true,
  },

  SAD_BODY: {
    id: "SAD_BODY",
    clip: "SAD_BODY",
    playback: "once",
    energy: "soft",
    focus: "emotional",
    gazeScale: 0.35,
    returnToIdle: true,
    requiresInPlace: true,
  },
} as const satisfies Record<VoidMotionId, VoidMotionSemantic>;

export function normalizeVoidMotionId(
  value: string | null | undefined,
): VoidMotionId | null {
  if (!value) return null;

  const normalized = value.toUpperCase();

  if (
    Object.prototype.hasOwnProperty.call(
      VOID_MOTION_SEMANTICS,
      normalized,
    )
  ) {
    return normalized as VoidMotionId;
  }

  return null;
}

export function isVoidMotionId(
  value: string | null | undefined,
): boolean {
  return normalizeVoidMotionId(value) !== null;
}

export function getVoidMotionSemantic(
  id: VoidMotionId | string | null | undefined,
): VoidMotionSemantic {
  const normalized = normalizeVoidMotionId(id);

  if (!normalized) {
    return VOID_MOTION_SEMANTICS.IDLE;
  }

  return VOID_MOTION_SEMANTICS[normalized];
}

export function validateVoidMotionSemantics(): void {
  const entries = Object.values(VOID_MOTION_SEMANTICS) as VoidMotionSemantic[];

  for (const motion of entries) {
    if (
      !Number.isFinite(motion.gazeScale) ||
      motion.gazeScale < 0 ||
      motion.gazeScale > 1
    ) {
      throw new Error(
        `[VOID Motion] gazeScale must be between 0 and 1: ${motion.id}`,
      );
    }

    if (motion.playback === "once" && !motion.returnToIdle) {
      throw new Error(
        `[VOID Motion] once motion must return to idle: ${motion.id}`,
      );
    }

    if (motion.playback === "loop" && motion.returnToIdle) {
      throw new Error(
        `[VOID Motion] loop motion should not declare returnToIdle: ${motion.id}`,
      );
    }

    if (!motion.requiresInPlace) {
      throw new Error(
        `[VOID Motion] desktop VOID motions must be in-place: ${motion.id}`,
      );
    }
  }
}
