import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("OpenAICompatibleProvider", () => {
  it("posts OpenAI chat format with auth, history and json mode", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: '{"speech":"在呢"}' } }] }),
    );
    const p = new OpenAICompatibleProvider({
      baseUrl: "https://api.deepseek.com/",
      apiKey: "sk-test",
      model: "deepseek-flash",
      jsonMode: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await p.complete("SYS", "想你了", [
      { role: "user", content: "早" },
      { role: "assistant", content: '{"speech":"早呀"}' },
    ]);
    expect(out).toBe('{"speech":"在呢"}');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe("deepseek-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("strips a pasted /chat/completions suffix from baseUrl", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "x" } }] }),
    );
    const p = new OpenAICompatibleProvider({
      baseUrl: "https://x.example/v1/chat/completions",
      apiKey: "k",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await p.complete("s", "u");
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://x.example/v1/chat/completions");
  });

  it("rejects without calling the network when key is missing", async () => {
    const fetchImpl = vi.fn();
    const p = new OpenAICompatibleProvider({ baseUrl: "https://a", apiKey: " ", model: "m", fetchImpl });
    await expect(p.complete("s", "u")).rejects.toThrow("未填写 API Key");
    expect(await p.isAvailable()).toBe(false);
    expect(p.getLastError()).toBe("未填写 API Key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps HTTP errors to readable Chinese hints", async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: "https://a",
      apiKey: "bad",
      model: "m",
      fetchImpl: (async () => jsonResponse({ error: { message: "invalid key" } }, 401)) as unknown as typeof fetch,
    });
    await expect(p.complete("s", "u")).rejects.toThrow(/API Key 无效/);
    expect(await p.isAvailable()).toBe(false);
  });

  it("treats 404 on /models as reachable", async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: "https://a",
      apiKey: "k",
      model: "m",
      fetchImpl: (async () => new Response("", { status: 404 })) as unknown as typeof fetch,
    });
    expect(await p.isAvailable()).toBe(true);
  });

  it("calls default global fetch without Illegal invocation", async () => {
    const strict = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal("fetch", strict);
    const p = new OpenAICompatibleProvider({ baseUrl: "https://a", apiKey: "k", model: "m" });
    expect(await p.isAvailable()).toBe(true);
    vi.unstubAllGlobals();
  });
});
