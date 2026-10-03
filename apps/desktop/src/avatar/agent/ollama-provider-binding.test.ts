import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "./ollama-provider";

afterEach(() => vi.unstubAllGlobals());

describe("OllamaProvider — 默认 fetch 绑定", () => {
  it("does not call global fetch with the provider as `this` (browser Illegal invocation)", async () => {
    // 模拟浏览器原生 fetch：this 不是 globalThis 时抛 Illegal invocation
    const strictFetch = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", strictFetch);

    const provider = new OllamaProvider();
    await expect(provider.isAvailable()).resolves.toBe(true);
    expect(strictFetch).toHaveBeenCalledOnce();
  });
});
