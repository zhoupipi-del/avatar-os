import { describe, it, expect } from "vitest";
import {
  VOID_CALIBRATION,
  validateVoidCalibration,
  type VoidCalibration,
} from "./void-calibration";

describe("VOID Calibration", () => {
  it("should validate default configuration successfully", () => {
    expect(() => validateVoidCalibration()).not.toThrow();
  });

  it("should enforce gaze distribution summing to 1", () => {
    const invalid: VoidCalibration = {
      ...VOID_CALIBRATION,
      gaze: {
        ...VOID_CALIBRATION.gaze,
        distribution: {
          head: 0.5,
          neck: 0.15,
          spine: 0.05,
        },
      },
    };

    expect(() => validateVoidCalibration(invalid)).toThrow(/sum to 1/);
  });

  it("should enforce valid blink interval range", () => {
    const invalid: VoidCalibration = {
      ...VOID_CALIBRATION,
      blink: {
        ...VOID_CALIBRATION.blink,
        minIntervalSeconds: 10,
        maxIntervalSeconds: 5,
      },
    };

    expect(() => validateVoidCalibration(invalid)).toThrow(/greater than min/);
  });
});
