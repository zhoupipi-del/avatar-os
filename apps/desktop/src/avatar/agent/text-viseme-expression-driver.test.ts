import { describe, expect, it, vi } from "vitest";

import { TextVisemeExpressionDriver } from "./text-viseme-expression-driver";
import { LIP_SYNC_MOUTH_SHAPES } from "./lip-sync-expression-writer";

function createManager() {
  return {
    setValue: vi.fn(),
  };
}

describe("TextVisemeExpressionDriver", () => {
  it("does not write expressions when probe is unavailable", () => {
    const manager = createManager();
    const driver = new TextVisemeExpressionDriver({
      now: () => 1000,
    });

    driver.setProbeAvailable(false, manager);
    driver.startText("你好");
    driver.update(manager, 0.016);

    expect(manager.setValue).toHaveBeenCalled();
    const nonZeroWrites = manager.setValue.mock.calls.filter(([, value]) => value > 0);
    expect(nonZeroWrites).toHaveLength(0);
  });

  it("writes only allowed mouth shapes when probe is available", () => {
    let now = 1000;
    const manager = createManager();
    const driver = new TextVisemeExpressionDriver({
      now: () => now,
    });

    driver.setProbeAvailable(true, manager);
    driver.startText("你好，我在。");

    now = 1100;
    driver.update(manager, 0.016);

    const writtenShapes = manager.setValue.mock.calls.map(([shape]) => shape);
    expect(writtenShapes.length).toBeGreaterThan(0);

    for (const shape of writtenShapes) {
      expect(LIP_SYNC_MOUTH_SHAPES).toContain(shape);
    }
  });

  it("resets all mouth shapes on cancel", () => {
    const manager = createManager();
    const driver = new TextVisemeExpressionDriver({
      now: () => 1000,
    });

    driver.setProbeAvailable(true, manager);
    driver.startText("你好");
    driver.cancel(manager);

    for (const shape of LIP_SYNC_MOUTH_SHAPES) {
      expect(manager.setValue).toHaveBeenCalledWith(shape, 0);
    }
  });

  it("stops writing non-zero values when disabled", () => {
    const manager = createManager();
    const driver = new TextVisemeExpressionDriver({
      now: () => 1000,
    });

    driver.setProbeAvailable(true, manager);
    driver.setEnabled(false, manager);
    driver.startText("你好");
    driver.update(manager, 0.016);

    const nonZeroWrites = manager.setValue.mock.calls.filter(([, value]) => value > 0);
    expect(nonZeroWrites).toHaveLength(0);
  });

  it("returns debug status", () => {
    const driver = new TextVisemeExpressionDriver({
      now: () => 1000,
    });

    driver.setProbeAvailable(true);
    driver.startText("你好");

    const status = driver.getStatus();

    expect(status.enabled).toBe(true);
    expect(status.timeline.textLength).toBe(2);
    expect(status.writer.probeAvailable).toBe(true);
  });
});
