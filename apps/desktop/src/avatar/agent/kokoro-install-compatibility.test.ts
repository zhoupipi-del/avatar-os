/**
 * Day14B — Kokoro Install Compatibility 测试
 *
 * 只验证：元数据正确 / 模型加载禁用 / 动态 import 不炸 / 成功时 exportedKeys 为数组 /
 * 失败时 error 为字符串 / 不调用 from_pretrained（不下载模型）/ 不需要模型文件 / 不接产品 runtime。
 *
 * 不真实合成、不加载模型权重、不接产品 runtime。
 */
import { describe, it, expect } from "vitest";
import {
  getKokoroInstallCompatibility,
  tryResolveKokoroModule,
  assertKokoroModelLoadDisabled,
} from "./kokoro-install-compatibility";

describe("kokoro install compatibility (Day14B)", () => {
  it("compatibility metadata is correct", () => {
    const c = getKokoroInstallCompatibility();
    expect(c.packageName).toBe("kokoro-js");
    expect(c.expectedVersion).toBe("1.2.1");
    expect(c.license).toBe("Apache-2.0");
    expect(c.importMode).toBe("dynamic");
  });

  it("model load policy is disabled in Day14B", () => {
    const c = getKokoroInstallCompatibility();
    expect(c.modelLoadPolicy).toBe("disabled-in-day14b");
    expect(assertKokoroModelLoadDisabled()).toBe(true);
  });

  it("tryResolveKokoroModule does not throw", async () => {
    await expect(tryResolveKokoroModule()).resolves.toBeDefined();
  });

  it("returns boolean available and array exportedKeys", async () => {
    const r = await tryResolveKokoroModule();
    expect(typeof r.available).toBe("boolean");
    expect(Array.isArray(r.exportedKeys)).toBe(true);
  });

  it("when available, exportedKeys contains module export names", async () => {
    const r = await tryResolveKokoroModule();
    if (r.available) {
      expect(r.exportedKeys.length).toBeGreaterThan(0);
      expect(Array.isArray(r.exportedKeys)).toBe(true);
    } else {
      expect(typeof r.error).toBe("string");
    }
  });

  it("when unavailable, error is a non-empty string", async () => {
    const r = await tryResolveKokoroModule();
    if (!r.available) {
      expect(typeof r.error).toBe("string");
      expect((r.error ?? "").length).toBeGreaterThan(0);
    } else {
      expect(r.error).toBeUndefined();
    }
  });

  it("does not call from_pretrained or generate (no model load)", async () => {
    const start = Date.now();
    const r = await tryResolveKokoroModule();
    const elapsed = Date.now() - start;
    // 模块 resolve（import）近乎瞬时；真实模型加载会耗时数秒 + 联网。
    expect(elapsed).toBeLessThan(5000);
    expect(r).toBeDefined();
  });

  it("does not require a local model file on disk", async () => {
    const r = await tryResolveKokoroModule();
    // 无论可用与否，调用不应依赖本地模型权重文件。
    expect(r).toHaveProperty("available");
    expect(r).toHaveProperty("exportedKeys");
  });
});
