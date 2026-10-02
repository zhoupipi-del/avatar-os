export type VoidExpressionName =
  | "idle"
  | "happy"
  | "sad"
  | "thinking"
  | "drowsy";

export type VoidFacialExpression =
  | "happy"
  | "sad"
  | "relaxed"
  | "surprised";

export type VoidMotionType =
  | "IDLE"
  | "GREET"
  | "GREET_ALT"
  | "BOUNCE_HAPPY"
  | "PEEK"
  | "THINKING"
  | "HAPPY_IDLE"
  | "SAD_BODY";

export interface VoidExpressionPreset {
  readonly happy: number;
  readonly sad: number;
  readonly relaxed: number;
  readonly surprised: number;
}

export interface VoidCalibration {
  readonly features: {
    readonly upperBodyGaze: boolean;
    readonly naturalBlink: boolean;
    readonly calibratedExpression: boolean;
    readonly springBoneMicroMotion: boolean;
  };

  readonly gaze: {
    readonly maxPitch: number;
    readonly maxYaw: number;
    readonly response: number;
    readonly distribution: {
      readonly head: number;
      readonly neck: number;
      readonly spine: number;
    };
  };

  readonly expression: {
    readonly response: number;
    readonly presets: Record<VoidExpressionName, VoidExpressionPreset>;
  };

  readonly blink: {
    readonly minIntervalSeconds: number;
    readonly maxIntervalSeconds: number;
    readonly closeSeconds: number;
    readonly holdSeconds: number;
    readonly openSeconds: number;
    readonly doubleBlinkChance: number;
    readonly doubleBlinkGapSeconds: number;
  };

  readonly stability: {
    readonly maxDeltaSeconds: number;
    readonly invalidFrameWarningCooldownMs: number;
  };
}

export const VOID_CALIBRATION = {
  features: {
    upperBodyGaze: true,
    naturalBlink: true,
    calibratedExpression: true,
    springBoneMicroMotion: false,
  },

  gaze: {
    maxPitch: 0.22,
    maxYaw: 0.34,
    response: 8,
    distribution: {
      head: 0.8,
      neck: 0.15,
      spine: 0.05,
    },
  },

  expression: {
    response: 8,
    presets: {
      idle: { happy: 0, sad: 0, relaxed: 0.12, surprised: 0 },
      happy: { happy: 0.55, sad: 0, relaxed: 0.18, surprised: 0 },
      sad: { happy: 0, sad: 0.45, relaxed: 0, surprised: 0 },
      thinking: { happy: 0, sad: 0, relaxed: 0.08, surprised: 0.08 },
      drowsy: { happy: 0, sad: 0.08, relaxed: 0.28, surprised: 0 },
    },
  },

  blink: {
    minIntervalSeconds: 3.5,
    maxIntervalSeconds: 6.5,
    closeSeconds: 0.09,
    holdSeconds: 0.025,
    openSeconds: 0.13,
    doubleBlinkChance: 0.08,
    doubleBlinkGapSeconds: 0.11,
  },

  stability: {
    maxDeltaSeconds: 0.05,
    invalidFrameWarningCooldownMs: 5_000,
  },
} as const satisfies VoidCalibration;

export function validateVoidCalibration(
  calibration: VoidCalibration = VOID_CALIBRATION,
): void {
  const { head, neck, spine } = calibration.gaze.distribution;
  const sum = head + neck + spine;

  if (Math.abs(sum - 1) > 0.0001) {
    throw new Error(`[VOID] Gaze distribution must sum to 1; received ${sum}`);
  }

  const expressions = Object.values(calibration.expression.presets);
  for (const preset of expressions) {
    for (const value of Object.values(preset)) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`[VOID] Expression values must be finite values between 0 and 1`);
      }
    }
  }

  if (calibration.blink.maxIntervalSeconds <= calibration.blink.minIntervalSeconds) {
    throw new Error(`[VOID] Blink max interval must be strictly greater than min interval`);
  }
}
