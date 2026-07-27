import { describe, expect, it } from "vitest";

import { LipSyncNoopHarness } from "./lip-sync-noop-harness";

describe("LipSyncNoopHarness", () => {
  it("starts in missing-shapes mode by default", () => {
    const harness = new LipSyncNoopHarness({
      now: () => 1000,
    });

    expect(harness.getStatus().mode).toBe("missing-shapes");
    expect(harness.getStatus().available).toBe(false);
  });

  it("enters probe-ready mode when lip shapes are available", () => {
    const harness = new LipSyncNoopHarness({
      now: () => 1000,
    });

    harness.setProbeResult({
      available: true,
      availableShapes: ["a", "i", "u", "e", "o"],
    });

    expect(harness.getStatus().mode).toBe("probe-ready");
    expect(harness.getStatus().availableShapes).toEqual(["a", "i", "u", "e", "o"]);
  });

  it("tracks speech text without driving expressions", () => {
    let now = 1000;

    const harness = new LipSyncNoopHarness({
      now: () => now,
      estimateMsPerChar: 100,
      minSpeechMs: 500,
      maxSpeechMs: 5000,
    });

    harness.setProbeResult({
      available: true,
      availableShapes: ["a", "i", "u", "e", "o"],
    });

    harness.notifySpeechText("你好，我在。");

    expect(harness.getStatus().mode).toBe("speaking-text");
    expect(harness.getStatus().speaking).toBe(true);
    expect(harness.getStatus().lastText).toBe("你好，我在。");

    now = 10000;
    harness.update();

    expect(harness.getStatus().speaking).toBe(false);
    expect(harness.getStatus().mode).toBe("probe-ready");
  });

  it("cancels speech state", () => {
    const harness = new LipSyncNoopHarness({
      now: () => 1000,
    });

    harness.setProbeResult({
      available: true,
      availableShapes: ["a", "i", "u", "e", "o"],
    });

    harness.notifySpeechText("你好");
    expect(harness.getStatus().speaking).toBe(true);

    harness.cancel();

    expect(harness.getStatus().speaking).toBe(false);
  });

  it("does not enter speaking mode while disabled", () => {
    const harness = new LipSyncNoopHarness({
      enabled: false,
      now: () => 1000,
    });

    harness.setProbeResult({
      available: true,
      availableShapes: ["a", "i", "u", "e", "o"],
    });

    harness.notifySpeechText("你好");

    expect(harness.getStatus().mode).toBe("disabled");
    expect(harness.getStatus().speaking).toBe(false);
  });
});
