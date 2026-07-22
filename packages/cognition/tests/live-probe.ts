// 真机探针：用本地 Ollama 实跑 Cognition 链路，验证"活起来"的质量。
// 仅本地开发用（依赖 localhost:11434 + 已拉模型），CI 不跑。
import { describe, it } from "vitest";
import { OllamaProvider } from "../src/provider";
import { CognitionEngine, VALID_MOODS } from "../src/cognition-engine";
import { kernelEventBus, AgentSandbox } from "@avatar-os/runtime";
import { Mood } from "@avatar-os/primitives";

// 探针在 node 环境跑；runtime 的 AvatarFSM 假设浏览器全局 window。
// 这里 shim 一下让 node 也能跑完整条链路（仅探针用，不碰 runtime 代码）。
(globalThis as any).window = globalThis;

const MODEL = process.env.PROBE_MODEL || "qwen2.5:0.5b";

describe("live probe (real Ollama)", () => {
  it("provider 原始产出 & 引擎链路", async () => {
    const provider = new OllamaProvider(MODEL);

    // 1) 直接看 provider 原始 JSON 质量
    const sys =
      "你是桌面上一个名叫「二狗子」的萌系桌面宠物，性格接地气。\n" +
      "请用简体中文回复，不超过 80 字。\n" +
      '只输出一个 JSON 对象，格式：{"intent":"GREET|PEEK|STRETCH","speech":"你说的话","mood":"CALM|CURIOUS|HAPPY"}\n' +
      "当前情绪：CALM，能量：0.80，孤独感：0.20";
    const raw = await provider.generate('用户说："你好"', sys);
    console.log(`\n[PROBE] model=${MODEL}`);
    // 直接 fetch 看原始响应，区分"连不上" vs "模型没出 JSON"
    const probeRes = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: sys + '\n\n用户说："你好"', stream: false }),
    });
    const probeJson: any = await probeRes.json().catch(() => ({}));
    console.log("[PROBE] HTTP status =", probeRes.status);
    console.log("[PROBE] RAW content =", JSON.stringify((probeJson.message?.content ?? "").slice(0, 400)));
    console.log("[PROBE] provider.ok =", raw.ok);
    console.log("[PROBE] provider.speech =", JSON.stringify(raw.speech));
    console.log("[PROBE] provider.intent(raw) =", JSON.stringify(raw.intent), "(未归一化, 透传原文)");
    console.log("[PROBE] provider.mood =", raw.mood, "valid?", raw.mood ? VALID_MOODS.has(raw.mood) : "n/a");

    // 2) 跑完整引擎，订阅事件看链路
    const seen: string[] = [];
    const offs = [
      kernelEventBus.on("MEMORY_APPEND", (p: any) => seen.push(`MEMORY_APPEND(${p.source}):${p.content}`)),
      kernelEventBus.on("AVATAR_THOUGHT", (p: any) => seen.push(`AVATAR_THOUGHT(${p.kind}):${p.text ?? ""}`)),
      kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (p: any) => seen.push(`PHYSICAL_INTENT_DISPATCH:${JSON.stringify(p)}`)),
      kernelEventBus.on("INTENT_NORMALIZED", (p: any) => seen.push(`INTENT_NORMALIZED raw="${p.raw}" → ${p.normalized} (matched=${p.matched})`)),
      kernelEventBus.on("STATE_MOOD_CHANGED", (p: any) => seen.push(`STATE_MOOD_CHANGED:${p.mood}`)),
    ];

    const engine = new CognitionEngine(AgentSandbox, provider);
    await engine.think({
      userInput: "你好",
      currentMood: Mood.CALM,
      energy: 0.8,
      loneliness: 0.2,
    });

    offs.forEach((o) => o());
    console.log("[PROBE] event chain:");
    seen.forEach((s) => console.log("   -", s));
  }, 60000);
});
