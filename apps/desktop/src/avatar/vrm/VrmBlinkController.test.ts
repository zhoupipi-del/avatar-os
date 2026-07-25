import { describe, it, expect } from "vitest";
import { VrmBlinkController } from "./VrmBlinkController";
import type { VRM } from "@pixiv/three-vrm";
import { VOID_CALIBRATION } from "../void-calibration";

describe("VrmBlinkController", () => {
  const createMockVrm = () => {
    let blinkValue = 0;
    const vrm = {
      expressionManager: {
        setValue: (name: string, value: number) => {
          if (name === "blink") blinkValue = value;
        },
      },
    } as unknown as VRM;

    return {
      vrm,
      getBlinkValue: () => blinkValue,
    };
  };

  function advance(
    controller: VrmBlinkController,
    seconds: number,
    step = 0.016,
  ): void {
    let remaining = seconds;
    while (remaining > 0) {
      const delta = Math.min(step, remaining);
      controller.update(delta);
      remaining -= delta;
    }
  }

  it("should trigger blink after wait time using deterministic RNG", () => {
    const { vrm, getBlinkValue } = createMockVrm();

    // 0: 最小等待间隔, 1: 禁止双眨
    const rngValues = [0, 1];
    const fakeRng = () => rngValues.shift() ?? 1;

    const controller = new VrmBlinkController(vrm, fakeRng);
    const minWait = VOID_CALIBRATION.blink.minIntervalSeconds;

    advance(controller, minWait - 0.1);
    expect(getBlinkValue()).toBe(0);

    advance(controller, 0.2);
    // 进入 Closing 阶段
    expect(getBlinkValue()).toBeGreaterThan(0);
  });

  it("should process through closing -> holding -> opening phases", () => {
    const { vrm, getBlinkValue } = createMockVrm();
    const rngValues = [0, 1];
    const fakeRng = () => rngValues.shift() ?? 1;

    const controller = new VrmBlinkController(vrm, fakeRng);

    // 跳过初始 Waiting 阶段
    advance(controller, VOID_CALIBRATION.blink.minIntervalSeconds + 0.01);

    // Closing 阶段
    advance(controller, VOID_CALIBRATION.blink.closeSeconds);
    expect(getBlinkValue()).toBeCloseTo(1, 1);

    // Holding 阶段
    advance(controller, VOID_CALIBRATION.blink.holdSeconds);
    expect(getBlinkValue()).toBeCloseTo(1, 1);

    // Opening 阶段
    advance(controller, VOID_CALIBRATION.blink.openSeconds);
    expect(getBlinkValue()).toBe(0);
  });
});
