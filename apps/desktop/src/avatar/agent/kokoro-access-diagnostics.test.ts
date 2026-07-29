/**
 * Day14D — Kokoro Access Diagnostics 单元测试
 *
 * 全部离线纯字符串分类测试：不发网络请求、不下载模型、不带真实凭据。
 */
import { describe, expect, it } from "vitest";
import {
  buildKokoroAccessReport,
  classifyKokoroAccessError,
  getKokoroAccessHint,
  type KokoroAccessFailureKind,
} from "./kokoro-access-diagnostics";

describe("classifyKokoroAccessError", () => {
  it("classifies Day14C real-world failure: 401 Unauthorized file access", () => {
    const c = classifyKokoroAccessError(
      new Error('Unauthorized access to file: "https://example-model-host/resolve/main/tokenizer_config.json".'),
    );
    expect(c.kind).toBe("hf-unauthorized");
    expect(c.evidence).toContain("Unauthorized");
  });

  it("classifies proxy auth failure: Invalid username or password", () => {
    const c = classifyKokoroAccessError("HTTPError: 401 Unauthorized - Invalid username or password.");
    expect(c.kind).toBe("proxy-auth-required");
  });

  it("classifies 404 as model-not-found", () => {
    expect(classifyKokoroAccessError(new Error("404 Client Error: repository not found")).kind).toBe(
      "model-not-found",
    );
  });

  it("classifies network errors as network-unreachable", () => {
    for (const msg of ["getaddrinfo ENOTFOUND host", "connect ECONNREFUSED 1.2.3.4:443", "ETIMEDOUT", "fetch failed"]) {
      expect(classifyKokoroAccessError(new Error(msg)).kind).toBe("network-unreachable");
    }
  });

  it("classifies module / api / generic / empty errors", () => {
    expect(classifyKokoroAccessError(new Error("Cannot find module 'x'")).kind).toBe("module-missing");
    expect(classifyKokoroAccessError(new TypeError("from_pretrained is not a function")).kind).toBe("api-missing");
    expect(classifyKokoroAccessError(new Error("onnx graph invalid")).kind).toBe("model-load-failed");
    expect(classifyKokoroAccessError(null).kind).toBe("none");
    expect(classifyKokoroAccessError("").kind).toBe("none");
  });
});

describe("getKokoroAccessHint", () => {
  it("returns a non-empty hint for every kind and never leaks credentials", () => {
    const kinds: KokoroAccessFailureKind[] = [
      "none",
      "proxy-auth-required",
      "hf-unauthorized",
      "network-unreachable",
      "model-not-found",
      "module-missing",
      "api-missing",
      "model-load-failed",
      "unknown",
    ];
    for (const kind of kinds) {
      const hint = getKokoroAccessHint(kind);
      expect(hint.length).toBeGreaterThan(0);
      // 提示文本不允许出现疑似明文凭据的模式
      expect(hint).not.toMatch(/password\s*[:=]\s*\S/i);
      expect(hint).not.toMatch(/token\s*[:=]\s*\S/i);
      expect(hint).not.toMatch(/127\.0\.0\.1:\d+/);
    }
  });
});

describe("buildKokoroAccessReport", () => {
  it("reports module-missing / api-missing as non-access issues", () => {
    const r1 = buildKokoroAccessReport({ moduleLoaded: false, apiAvailable: false, error: null });
    expect(r1.kind).toBe("module-missing");
    expect(r1.isAccessIssue).toBe(false);

    const r2 = buildKokoroAccessReport({ moduleLoaded: true, apiAvailable: false, error: null });
    expect(r2.kind).toBe("api-missing");
    expect(r2.isAccessIssue).toBe(false);
  });

  it("reports access issues for proxy/hf/network failures and none for clean run", () => {
    const proxy = buildKokoroAccessReport({
      moduleLoaded: true,
      apiAvailable: true,
      error: new Error("401 Invalid username or password."),
    });
    expect(proxy.kind).toBe("proxy-auth-required");
    expect(proxy.isAccessIssue).toBe(true);
    expect(proxy.hint.length).toBeGreaterThan(0);

    const clean = buildKokoroAccessReport({ moduleLoaded: true, apiAvailable: true, error: null });
    expect(clean.kind).toBe("none");
    expect(clean.isAccessIssue).toBe(false);
  });
});
