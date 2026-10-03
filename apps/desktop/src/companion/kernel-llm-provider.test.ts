import { describe, expect, it, vi } from "vitest";
import { CompanionSettingsStore, defaultSettingsFromEnv } from "./companion-settings";
import { CompanionKernelProvider } from "./kernel-llm-provider";

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("CompanionKernelProvider（主动陪伴）", () => {
  it("cloud: returns speech/mood/intent from JSON", async () => {
    const store = new CompanionSettingsStore(defaultSettingsFromEnv({ VITE_CLOUD_API_KEY: "sk" }), null, false);
    const fetchImpl = vi.fn(async () => ok('```json\n{"speech":"喝口水吧","mood":"HAPPY","intent":"GREET"}\n```'));
    const r = await new CompanionKernelProvider(store, fetchImpl as unknown as typeof fetch).generate("u", "s");
    expect(r).toEqual({ ok: true, speech: "喝口水吧", mood: "HAPPY", intent: "GREET" });
  });

  it("cloud failure / empty speech → ok:false (silent)", async () => {
    const store = new CompanionSettingsStore(defaultSettingsFromEnv({ VITE_CLOUD_API_KEY: "sk" }), null, false);
    const down = vi.fn(async () => new Response("", { status: 500 }));
    expect((await new CompanionKernelProvider(store, down as unknown as typeof fetch).generate("u", "s")).ok).toBe(false);
    const empty = vi.fn(async () => ok("{}"));
    expect((await new CompanionKernelProvider(store, empty as unknown as typeof fetch).generate("u", "s")).ok).toBe(false);
  });

  it("rule mode never calls the network", async () => {
    const store = new CompanionSettingsStore(defaultSettingsFromEnv({ VITE_AVATAROS_BRAIN_MODE: "rule" }), null, false);
    const fetchImpl = vi.fn();
    expect((await new CompanionKernelProvider(store, fetchImpl as unknown as typeof fetch).generate("u", "s")).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
