import { describe, expect, it, vi } from "vitest";
import {
  CompanionSettingsStore,
  defaultSettingsFromEnv,
  isQuietHour,
  isSettingsLocked,
  type CompanionSettings,
  type SettingsStorage,
} from "./companion-settings";
import { buildChatSystemPrompt, buildProactivePersona, describeNow, resolvePersonaText, stripHtmlComments } from "./persona";
import { CompanionBrain } from "./companion-brain";
import { ConversationMemory } from "../avatar/agent/conversation-memory";
import { isUserPresent, markPresence, markUserActivity } from "./activity";

function memStorage(initial: Partial<CompanionSettings> | null = null) {
  let data = initial;
  const storage: SettingsStorage = { load: () => data, save: (v) => (data = { ...v }) };
  return { storage, read: () => data };
}

describe("companion settings", () => {
  it("defaults: no key → ollama; key in env → cloud with DeepSeek preset", () => {
    expect(defaultSettingsFromEnv({}).brainMode).toBe("ollama");
    const d = defaultSettingsFromEnv({ VITE_CLOUD_API_KEY: "sk-x", VITE_COMPANION_NAME: "阿杰", VITE_COMPANION_NICKNAME: "宝" });
    expect(d).toMatchObject({
      brainMode: "cloud",
      cloudPreset: "deepseek",
      cloudBaseUrl: "https://api.deepseek.com",
      cloudModel: "deepseek-flash",
      cloudApiKey: "sk-x",
      companionName: "阿杰",
      userNickname: "宝",
    });
  });

  it("explicit env mode wins; qwen preset fills its url/model", () => {
    const d = defaultSettingsFromEnv({ VITE_AVATAROS_BRAIN_MODE: "rule", VITE_CLOUD_PRESET: "qwen", VITE_CLOUD_API_KEY: "k" });
    expect(d.brainMode).toBe("rule");
    expect(d.cloudBaseUrl).toContain("dashscope");
  });

  it("user overrides persist and merge over env defaults", () => {
    const { storage, read } = memStorage();
    const store = new CompanionSettingsStore(defaultSettingsFromEnv({}), storage, false);
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.brainMode));
    store.update({ brainMode: "cloud", cloudApiKey: "sk-1" });
    expect(store.get().brainMode).toBe("cloud");
    expect(read()).toMatchObject({ brainMode: "cloud", cloudApiKey: "sk-1" });
    expect(seen).toEqual(["cloud"]);

    const reloaded = new CompanionSettingsStore(defaultSettingsFromEnv({}), storage, false);
    expect(reloaded.get().cloudApiKey).toBe("sk-1");
  });

  it("applyPreset resets url and model", () => {
    const store = new CompanionSettingsStore(defaultSettingsFromEnv({}), null, false);
    store.update({ cloudModel: "whatever" });
    store.applyPreset("qwen");
    expect(store.get()).toMatchObject({ cloudPreset: "qwen", cloudModel: "qwen-plus" });
  });

  it("locked mode ignores stored overrides for brain/persona but keeps proactive prefs", () => {
    const { storage } = memStorage({ cloudApiKey: "stale", companionName: "x", proactiveIntervalMin: 90 });
    const env = { VITE_CLOUD_API_KEY: "sk-baked", VITE_COMPANION_NAME: "阿杰", VITE_COMPANION_LOCK_SETTINGS: "true" };
    expect(isSettingsLocked(env)).toBe(true);
    const store = new CompanionSettingsStore(defaultSettingsFromEnv(env), storage, isSettingsLocked(env));
    expect(store.get()).toMatchObject({ cloudApiKey: "sk-baked", companionName: "阿杰", proactiveIntervalMin: 90 });
  });

  it("sanitizes garbage from storage", () => {
    const { storage } = memStorage({ brainMode: "hack" as never, proactiveIntervalMin: 1, quietStartHour: 99 });
    const store = new CompanionSettingsStore(defaultSettingsFromEnv({}), storage, false);
    expect(store.get().brainMode).toBe("ollama");
    expect(store.get().proactiveIntervalMin).toBe(5);
    expect(store.get().quietStartHour).toBe(23);
  });

  it("quiet hours handle same-day and overnight ranges", () => {
    const at = (h: number) => new Date(2026, 9, 3, h, 30);
    expect(isQuietHour({ quietStartHour: 0, quietEndHour: 8 }, at(3))).toBe(true);
    expect(isQuietHour({ quietStartHour: 0, quietEndHour: 8 }, at(9))).toBe(false);
    expect(isQuietHour({ quietStartHour: 23, quietEndHour: 7 }, at(23))).toBe(true);
    expect(isQuietHour({ quietStartHour: 23, quietEndHour: 7 }, at(6))).toBe(true);
    expect(isQuietHour({ quietStartHour: 23, quietEndHour: 7 }, at(12))).toBe(false);
    expect(isQuietHour({ quietStartHour: 5, quietEndHour: 5 }, at(5))).toBe(false);
  });
});

describe("persona prompts", () => {
  const settings = { ...defaultSettingsFromEnv({}), companionName: "阿杰", userNickname: "宝" };
  const now = new Date(2026, 9, 3, 23, 40);

  it("strips template comments", () => {
    expect(stripHtmlComments("<!-- hi -->\n正文")).toBe("正文");
  });

  it("custom persona text wins over the bundled file", () => {
    expect(resolvePersonaText({ personaText: "  我是阿杰  " }, "FILE")).toBe("我是阿杰");
    expect(resolvePersonaText({ personaText: "" }, "FILE")).toBe("FILE");
  });

  it("chat prompt contains persona, names, current time and JSON contract", () => {
    const p = buildChatSystemPrompt(settings, now, "你是她男朋友");
    expect(p).toContain("你是她男朋友");
    expect(p).toContain("你的名字：阿杰");
    expect(p).toContain("「宝」");
    expect(p).toContain("2026年10月3日 星期六 23:40（深夜）");
    expect(p).toContain('"speech"');
    expect(p).toContain("GREET");
  });

  it("proactive persona mentions time and brevity", () => {
    const p = buildProactivePersona(settings, now, "人设");
    expect(p).toContain("人设");
    expect(p).toContain("深夜");
    expect(p).toContain("主动");
  });

  it("describeNow covers periods", () => {
    expect(describeNow(new Date(2026, 0, 1, 7, 5))).toContain("早上");
    expect(describeNow(new Date(2026, 0, 1, 15, 0))).toContain("下午");
  });
});

describe("CompanionBrain", () => {
  const reply = (speech: string) =>
    new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify({ speech, intent: { type: "NONE", intensity: 0 }, emotion: { type: "happy", intensity: 0.5 } }) } },
        ],
      }),
      { status: 200 },
    );

  it("uses cloud with persona prompt + history, and switches live when settings change", async () => {
    const store = new CompanionSettingsStore(defaultSettingsFromEnv({}), null, false);
    store.update({ brainMode: "cloud", cloudApiKey: "sk", companionName: "阿杰" });
    const bodies: Array<{ url: string; body: { messages: Array<{ role: string; content: string }> } }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return reply("想你啦");
    }) as unknown as typeof fetch;
    const memory = new ConversationMemory();
    const brain = new CompanionBrain({ store, memory, fetchImpl, buildSystemPrompt: (s) => `PERSONA:${s.companionName}` });

    const out = await brain.think({ text: "在干嘛" });
    expect(out.speech).toBe("想你啦");
    expect(bodies[0]!.url).toBe("https://api.deepseek.com/chat/completions");
    expect(bodies[0]!.body.messages[0]).toEqual({ role: "system", content: "PERSONA:阿杰" });
    expect(brain.getStatus()).toMatchObject({ source: "llm", provider: "DeepSeek" });

    // 改名字：无需重建，下一句即生效
    store.update({ companionName: "杰哥" });
    await brain.think({ text: "嗯嗯" });
    expect(bodies[1]!.body.messages[0]!.content).toBe("PERSONA:杰哥");
    expect(bodies[1]!.body.messages.length).toBe(4); // system + 上一轮 user/assistant + 本句

    // 切到离线规则：不再请求网络，但仍记录记忆
    store.update({ brainMode: "rule" });
    await brain.think({ text: "你好" });
    expect(bodies.length).toBe(2);
    expect(memory.size()).toBe(6);
    expect(brain.getStatus().provider).toBe("离线规则");
  });

  it("reports a readable error when the key is missing", async () => {
    const store = new CompanionSettingsStore(defaultSettingsFromEnv({}), null, false);
    store.update({ brainMode: "cloud", cloudApiKey: "" });
    const brain = new CompanionBrain({ store, fetchImpl: vi.fn() as unknown as typeof fetch });
    const st = await brain.probe();
    expect(st).toMatchObject({ source: "fallback", lastError: "未填写 API Key" });
    const out = await brain.think({ text: "你好" });
    expect(out.speech.length).toBeGreaterThan(0); // 规则脑兜底
  });
});

describe("activity / presence", () => {
  it("presence counts mouse/keyboard or chat within window", () => {
    const now = 10_000_000;
    expect(isUserPresent(60_000, now)).toBe(false);
    markPresence(now - 30_000);
    expect(isUserPresent(60_000, now)).toBe(true);
    expect(isUserPresent(10_000, now)).toBe(false);
    markUserActivity(now - 5_000);
    expect(isUserPresent(10_000, now)).toBe(true);
  });
});

describe("persona ground rules", () => {
  it("are always in the chat and proactive prompts, even with a custom persona", async () => {
    const { COMPANION_GROUND_RULES } = await import("./persona");
    const s = { ...defaultSettingsFromEnv({}), personaText: "你是阿杰，话很少。" };
    expect(buildChatSystemPrompt(s)).toContain(COMPANION_GROUND_RULES);
    expect(buildProactivePersona(s)).toContain(COMPANION_GROUND_RULES);
    expect(buildChatSystemPrompt(s)).toContain("你是阿杰，话很少。");
  });
});
