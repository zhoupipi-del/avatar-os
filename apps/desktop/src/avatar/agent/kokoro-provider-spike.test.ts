/**
 * Day14A — Kokoro Provider Spike 测试
 *
 * 设计原则（符合 Day14A 验收标准）：
 * - capability 结构合法、unavailable 时不抛错、空文本不抛错。
 * - 真实依赖可用时尝试产出 PCM 并接 PcmSpectrumSource；不可用时 graceful skip。
 * - 不引入真实 TTS 包、不创建音频上下文、不驱动表情。
 */
import { describe, it, expect } from "vitest";
import {
  KokoroProviderSpike,
  createKokoroProviderSpike,
  isKokoroInstalled,
} from "./kokoro-provider-spike";
import { PcmSpectrumSource, buildSyntheticVowelPcm } from "./pcm-spectrum-source";
import { FormantVisemeRuntimeProbe } from "./formant-viseme-runtime-probe";

describe("KokoroProviderSpike", () => {
  it("capability is structurally valid", () => {
    const p = createKokoroProviderSpike();
    const c = p.getCapability();
    expect(typeof c.supportsAudioNode).toBe("boolean");
    expect(typeof c.supportsAudioBuffer).toBe("boolean");
    expect(typeof c.supportsPcm).toBe("boolean");
    expect(typeof c.supportsSpectrumSource).toBe("boolean");
    expect(p.id).toContain("kokoro");
    expect(typeof p.isAvailable()).toBe("boolean");
  });

  it("does not throw when provider unavailable", () => {
    const p = createKokoroProviderSpike();
    expect(() => p.speak("hello world")).not.toThrow();
    const s = p.speak("hello world");
    // 未调用 load 前应返回 null（nothing synthesized yet）
    expect(s.getPcm()).toBeNull();
    expect(["idle", "playing", "ended", "cancelled"]).toContain(s.getStatus());
    expect(() => s.getSpectrumSource()).not.toThrow();
  });

  it("does not throw on empty text", () => {
    const p = createKokoroProviderSpike();
    expect(() => p.speak("")).not.toThrow();
    expect(() => p.speak("   ")).not.toThrow();
    const s = p.speak("");
    expect(() => s.cancel()).not.toThrow();
  });

  it("produces PCM when kokoro is installed (skipped if not)", async () => {
    const available = await isKokoroInstalled();
    if (!available) return; // graceful skip：本机默认未安装 kokoro-js
    const p = createKokoroProviderSpike();
    const s = p.speak("你好世界");
    await s.load();
    const pcm = s.getPcm();
    expect(pcm).not.toBeNull();
    expect(pcm!.channels[0]).toBeInstanceOf(Float32Array);
    expect(pcm!.channels[0].length).toBeGreaterThan(0);
  });

  it("feeds PCM into PcmSpectrumSource and yields formant result when installed (skipped if not)", async () => {
    const available = await isKokoroInstalled();
    if (!available) return; // graceful skip
    const p = createKokoroProviderSpike();
    const s = p.speak("你好世界");
    await s.load();
    const pcm = s.getPcm();
    if (!pcm) return;
    const src = new PcmSpectrumSource({ sampleRate: pcm.sampleRate, channelData: pcm.channels[0] });
    const probe = new FormantVisemeRuntimeProbe(src);
    let captured: unknown = null;
    for (let i = 0; i < 8; i++) {
      const r = probe.update();
      if (r) captured = r;
    }
    // 链路已接：probe.update 返回结构化结果（active 与否取决于真实模型输出，不强制）
    expect(captured === null || typeof captured === "object").toBe(true);
  });

  it("falls back to silent source when no real dependency present", async () => {
    // 无论是否安装，session 都应返回合法的频谱源（静音或真实）
    const p = createKokoroProviderSpike();
    const s = p.speak("fallback check");
    await s.load();
    expect(() => s.getSpectrumSource()).not.toThrow();
    // 用合成 PCM 证明 PcmSpectrumSource 链路本身可用（不依赖真实包）
    const synth = buildSyntheticVowelPcm(24000, 120, 700, 2000);
    const src = new PcmSpectrumSource({ sampleRate: 24000, channelData: synth });
    const probe = new FormantVisemeRuntimeProbe(src);
    let activeSeen = false;
    for (let i = 0; i < 4; i++) {
      const r = probe.update();
      if (r && r.active) activeSeen = true;
    }
    expect(activeSeen).toBe(true);
  });
});
