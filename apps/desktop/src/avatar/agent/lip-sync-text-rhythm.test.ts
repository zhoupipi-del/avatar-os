import { describe, expect, it } from "vitest";

import { LipSyncTextRhythmDriver } from "./lip-sync-text-rhythm";

describe("LipSyncTextRhythmDriver", () => {
  it("starts inactive and at rest", () => {
    const driver = new LipSyncTextRhythmDriver({ now: () => 1000 });

    const status = driver.getStatus();

    expect(status.active).toBe(false);
    expect(status.phase).toBe("rest");
    expect(status.intensity).toBe(0);
    expect(status.progress).toBe(0);
    expect(status.textLength).toBe(0);
  });

  it("starts rhythm state from speech text", () => {
    const driver = new LipSyncTextRhythmDriver({ now: () => 1000 });

    driver.startText("你好，我在。");

    const status = driver.getStatus();

    expect(status.active).toBe(true);
    expect(status.textLength).toBe(6);
    expect(status.estimatedDurationMs).toBeGreaterThan(0);
    expect(status.progress).toBe(0);
    expect(status.phase).toBe("opening");
  });

  it("advances phase and progress over time without writing expressions", () => {
    let now = 1000;

    const driver = new LipSyncTextRhythmDriver({
      now: () => now,
      msPerChar: 100,
      minMs: 500,
      maxMs: 5000,
    });

    driver.startText("你好");
    driver.update();

    const early = driver.getStatus();

    expect(early.active).toBe(true);
    expect(early.progress).toBe(0);

    now = 1100; // elapsed 100ms / duration 500ms => progress 0.2
    driver.update();

    const mid = driver.getStatus();

    expect(mid.progress).toBeGreaterThan(early.progress);
    expect(mid.active).toBe(true);
    expect(["rest", "opening", "open", "closing"]).toContain(mid.phase);
    expect(mid.intensity).toBeGreaterThanOrEqual(0);
    expect(mid.intensity).toBeLessThanOrEqual(1);
  });

  it("reaches rest after estimated end", () => {
    let now = 1000;

    const driver = new LipSyncTextRhythmDriver({
      now: () => now,
      msPerChar: 100,
      minMs: 300,
      maxMs: 3000,
    });

    driver.startText("你好"); // 2*100=200 -> clamped min 300ms

    now = 2000; // elapsed 1000ms >> 300ms
    driver.update();

    const done = driver.getStatus();

    expect(done.active).toBe(false);
    expect(done.phase).toBe("rest");
  });

  it("cancels rhythm state back to rest", () => {
    const driver = new LipSyncTextRhythmDriver({ now: () => 1000 });

    driver.startText("你好");
    expect(driver.getStatus().active).toBe(true);

    driver.cancel();

    const cancelled = driver.getStatus();

    expect(cancelled.active).toBe(false);
    expect(cancelled.phase).toBe("rest");
    expect(cancelled.progress).toBe(0);
  });

  it("does not start while disabled", () => {
    const driver = new LipSyncTextRhythmDriver({
      enabled: false,
      now: () => 1000,
    });

    driver.startText("你好");

    const status = driver.getStatus();

    expect(status.active).toBe(false);
    expect(status.phase).toBe("rest");
  });
});
