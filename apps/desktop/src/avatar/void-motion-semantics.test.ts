import { describe, expect, it } from "vitest";

import {
  getVoidMotionSemantic,
  isVoidMotionId,
  normalizeVoidMotionId,
  validateVoidMotionSemantics,
  VOID_MOTION_SEMANTICS,
} from "./void-motion-semantics";

describe("VOID motion semantics", () => {
  it("validates default semantics", () => {
    expect(() => validateVoidMotionSemantics()).not.toThrow();
  });

  it("contains the eight formal VOID motions", () => {
    expect(Object.keys(VOID_MOTION_SEMANTICS).sort()).toEqual(
      [
        "BOUNCE_HAPPY",
        "GREET",
        "GREET_ALT",
        "HAPPY_IDLE",
        "IDLE",
        "PEEK",
        "SAD_BODY",
        "THINKING",
      ].sort(),
    );
  });

  it("marks one-shot motions as return-to-idle", () => {
    for (const motion of Object.values(VOID_MOTION_SEMANTICS)) {
      if (motion.playback === "once") {
        expect(motion.returnToIdle).toBe(true);
      }
    }
  });

  it("keeps gazeScale inside presentation bounds", () => {
    for (const motion of Object.values(VOID_MOTION_SEMANTICS)) {
      expect(motion.gazeScale).toBeGreaterThanOrEqual(0);
      expect(motion.gazeScale).toBeLessThanOrEqual(1);
    }
  });

  it("normalizes motion ids case-insensitively and returns null for unknown", () => {
    expect(normalizeVoidMotionId("greet")).toBe("GREET");
    expect(normalizeVoidMotionId("PEEK")).toBe("PEEK");
    expect(normalizeVoidMotionId("unknown")).toBeNull();
    expect(normalizeVoidMotionId(null)).toBeNull();
  });

  it("falls back to IDLE for unknown motion in getVoidMotionSemantic", () => {
    expect(getVoidMotionSemantic("UNKNOWN").id).toBe("IDLE");
    expect(getVoidMotionSemantic(null).id).toBe("IDLE");
    expect(getVoidMotionSemantic(undefined).id).toBe("IDLE");
  });

  it("recognizes known motion ids correctly with isVoidMotionId", () => {
    expect(isVoidMotionId("GREET")).toBe(true);
    expect(isVoidMotionId("greet")).toBe(true);
    expect(isVoidMotionId("PEEK")).toBe(true);
    expect(isVoidMotionId("unknown")).toBe(false);
  });
});
