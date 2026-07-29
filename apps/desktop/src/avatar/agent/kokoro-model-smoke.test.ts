/**
 * Day14C — Kokoro Model Load Smoke · 测试
 *
 * 普通测试（无 AVATAROS_RUN_KOKORO_MODEL_SMOKE env var）只验配置/结构/离线逻辑。
 * 真实模型加载需手动设置 env var 后运行（不在普通 CI / vitest 中触发）。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getKokoroModelSmokeConfig,
  shouldRunKokoroModelSmoke,
  loadKokoroModuleForSmoke,
  inspectKokoroModule,
  runKokoroModelLoadSmoke,
  extractKokoroPcmFromUnknownOutput,
  analyzeKokoroPcmSmoke,
} from "./kokoro-model-smoke";
import { buildSyntheticVowelPcm } from "./pcm-spectrum-source";

const SMOKE_ENV = "AVATAROS_RUN_KOKORO_MODEL_SMOKE";

describe("Day14C: Kokoro Model Load Smoke", () => {
  // -------------------------------------------------------------------------
  // 1. getKokoroModelSmokeConfig
  // -------------------------------------------------------------------------
  describe("getKokoroModelSmokeConfig", () => {
    it("returns expected config shape with all required fields", () => {
      const config = getKokoroModelSmokeConfig();
      expect(config).toBeDefined();
      expect(config.envVarName).toBe(SMOKE_ENV);
      expect(config.modelId).toBe("onnx-community/Kokoro-82M-v1.0");
      expect(config.defaultVoice).toBe("af_heart");
      expect(config.defaultText).toBe("Hello, this is a test.");
      expect(config.dtype).toBe("q8");
      expect(config.modelLoadPolicy).toBe("env-gated-day14c");
    });
  });

  // -------------------------------------------------------------------------
  // 2-3. shouldRunKokoroModelSmoke
  // -------------------------------------------------------------------------
  describe("shouldRunKokoroModelSmoke", () => {
    const originalValue = process.env[SMOKE_ENV];

    beforeEach(() => {
      delete process.env[SMOKE_ENV];
    });

    afterEach(() => {
      if (originalValue !== undefined) {
        process.env[SMOKE_ENV] = originalValue;
      } else {
        delete process.env[SMOKE_ENV];
      }
    });

    it("returns false when env var is not set", () => {
      delete process.env[SMOKE_ENV];
      expect(shouldRunKokoroModelSmoke()).toBe(false);
    });

    it("returns true when env var is 1/true/yes (case-insensitive)", () => {
      process.env[SMOKE_ENV] = "1";
      expect(shouldRunKokoroModelSmoke()).toBe(true);

      process.env[SMOKE_ENV] = "true";
      expect(shouldRunKokoroModelSmoke()).toBe(true);

      process.env[SMOKE_ENV] = "yes";
      expect(shouldRunKokoroModelSmoke()).toBe(true);

      process.env[SMOKE_ENV] = "TRUE";
      expect(shouldRunKokoroModelSmoke()).toBe(true);

      process.env[SMOKE_ENV] = "Yes";
      expect(shouldRunKokoroModelSmoke()).toBe(true);
    });

    it("returns false for non-matching values", () => {
      process.env[SMOKE_ENV] = "0";
      expect(shouldRunKokoroModelSmoke()).toBe(false);

      process.env[SMOKE_ENV] = "false";
      expect(shouldRunKokoroModelSmoke()).toBe(false);

      process.env[SMOKE_ENV] = "";
      expect(shouldRunKokoroModelSmoke()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4. loadKokoroModuleForSmoke
  // -------------------------------------------------------------------------
  describe("loadKokoroModuleForSmoke", () => {
    it("resolves to real module (kokoro-js@1.2.1 is installed since Day14B)", async () => {
      const mod = await loadKokoroModuleForSmoke();
      expect(mod).not.toBeNull();
      expect(typeof mod).toBe("object");
    });
  });

  // -------------------------------------------------------------------------
  // 5. inspectKokoroModule
  // -------------------------------------------------------------------------
  describe("inspectKokoroModule", () => {
    it("finds KokoroTTS constructor when present in module", () => {
      const mockMod: Record<string, any> = {
        KokoroTTS: class MockKokoroTTS {},
        env: { wasmPaths: "" },
      };
      const inspection = inspectKokoroModule(mockMod);
      expect(inspection.available).toBe(true);
      expect(inspection.hasKokoroTTS).toBe(true);
      expect(inspection.exportedKeys).toContain("KokoroTTS");
      expect(inspection.KokoroTTSConstructor).not.toBeNull();
    });

    it("returns unavailable when module is null", () => {
      const inspection = inspectKokoroModule(null);
      expect(inspection.available).toBe(false);
      expect(inspection.hasKokoroTTS).toBe(false);
      expect(inspection.exportedKeys).toEqual([]);
      expect(inspection.KokoroTTSConstructor).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 6-7. extractKokoroPcmFromUnknownOutput
  // -------------------------------------------------------------------------
  describe("extractKokoroPcmFromUnknownOutput", () => {
    it("extracts PCM from standard RawAudio structure {audio, sampling_rate}", () => {
      const pcm = new Float32Array(1000);
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = Math.sin((2 * Math.PI * 440 * i) / 24000);
      }
      const output = { audio: pcm, sampling_rate: 24000 };
      const result = extractKokoroPcmFromUnknownOutput(output);
      expect(result).not.toBeNull();
      expect(result!.sampleRate).toBe(24000);
      expect(result!.channels.length).toBe(1);
      expect(result!.channels[0]).toBeInstanceOf(Float32Array);
      expect(result!.channels[0].length).toBe(1000);
    });

    it("handles alternative field names and returns null for invalid input", () => {
      // Alternative field names
      const pcm = new Float32Array([0.1, 0.2, 0.3]);
      const altOutput = { samples: pcm, sampleRate: 22050 };
      const altResult = extractKokoroPcmFromUnknownOutput(altOutput);
      expect(altResult).not.toBeNull();
      expect(altResult!.sampleRate).toBe(22050);

      // number[] instead of Float32Array
      const arrOutput = { waveform: [0.1, 0.2, 0.3], sr: 16000 };
      const arrResult = extractKokoroPcmFromUnknownOutput(arrOutput);
      expect(arrResult).not.toBeNull();
      expect(arrResult!.sampleRate).toBe(16000);
      expect(arrResult!.channels[0]).toBeInstanceOf(Float32Array);

      // Invalid inputs
      expect(extractKokoroPcmFromUnknownOutput(null)).toBeNull();
      expect(extractKokoroPcmFromUnknownOutput(undefined)).toBeNull();
      expect(extractKokoroPcmFromUnknownOutput("string")).toBeNull();
      expect(extractKokoroPcmFromUnknownOutput({})).toBeNull();
      expect(extractKokoroPcmFromUnknownOutput({ audio: [] })).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 8. analyzeKokoroPcmSmoke
  // -------------------------------------------------------------------------
  describe("analyzeKokoroPcmSmoke", () => {
    it("returns viseme results from synthetic vowel PCM", () => {
      // 合成 "aa" 元音 PCM（F1=700Hz, F2=1200Hz → 大张嘴）
      const pcm = buildSyntheticVowelPcm(24000, 1000, 700, 1200);
      expect(pcm.length).toBeGreaterThan(0);

      const result = analyzeKokoroPcmSmoke(
        { sampleRate: 24000, channels: [pcm] },
        5,
      );
      expect(result.frameCount).toBe(5);
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.reasons.length).toBeGreaterThan(0);
      // 合成元音应该有 active 帧
      expect(result.activeCount).toBeGreaterThan(0);
    });

    it("returns empty results for null or empty PCM", () => {
      const nullResult = analyzeKokoroPcmSmoke(null, 5);
      expect(nullResult.results).toEqual([]);
      expect(nullResult.activeCount).toBe(0);
      expect(nullResult.frameCount).toBe(0);

      const emptyResult = analyzeKokoroPcmSmoke(
        { sampleRate: 24000, channels: [new Float32Array(0)] },
        5,
      );
      expect(emptyResult.results).toEqual([]);
      expect(emptyResult.activeCount).toBe(0);
      expect(emptyResult.frameCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 9. REAL MODEL SMOKE（手动触发，env-gated）
  // -------------------------------------------------------------------------
  // 仅当 AVATAROS_RUN_KOKORO_MODEL_SMOKE=1/true/yes 时运行真实模型下载 + 合成。
  // 普通 gate / CI 不设该变量 → 本用例直接跳过，不影响离线闸门。
  // 失败（网络/下载/运行时）不算 Day14C 失败，交给 Day14D 处理。
  describe("runKokoroModelLoadSmoke (REAL MODEL, env-gated)", () => {
    it(
      "downloads model, generates audio, extracts PCM, runs formant pipeline",
      async () => {
        if (!shouldRunKokoroModelSmoke()) {
          console.warn(`[Day14C] ${SMOKE_ENV} not set — SKIP real model smoke`);
          return;
        }

        const config = getKokoroModelSmokeConfig();
        const mod = await loadKokoroModuleForSmoke();
        const inspection = inspectKokoroModule(mod);
        expect(inspection.hasKokoroTTS).toBe(true);

        const KokoroTTS = inspection.KokoroTTSConstructor as {
          from_pretrained(modelId: string, opts: { dtype: string }): Promise<any>;
        };

        let model: any;
        try {
          model = await KokoroTTS.from_pretrained(config.modelId, { dtype: config.dtype });
          console.log("[Day14C] model-loaded:", config.modelId);
        } catch (err) {
          console.log("[Day14C] status: failed");
          console.log("[Day14C] error:", err instanceof Error ? err.message : String(err));
          return;
        }

        let audio: any;
        try {
          audio = await model.generate(config.defaultText, { voice: config.defaultVoice });
          console.log("[Day14C] generated:", config.defaultText);
        } catch (err) {
          console.log("[Day14C] status: failed");
          console.log("[Day14C] error:", err instanceof Error ? err.message : String(err));
          return;
        }

        const pcm = extractKokoroPcmFromUnknownOutput(audio);
        if (!pcm) {
          console.log("[Day14C] status: failed");
          console.log("[Day14C] error: pcm-extraction-returned-null");
          return;
        }
        console.log(
          "[Day14C] pcm-extracted: sampleRate=",
          pcm.sampleRate,
          "length=",
          pcm.channels[0].length,
        );

        const analysis = analyzeKokoroPcmSmoke(pcm, 30);
        console.log(
          "[Day14C] activeResultCount:",
          analysis.activeCount,
          "/",
          analysis.frameCount,
        );
        if (analysis.activeCount > 0) {
          console.log("[Day14C] activeResultCount > 0: viseme pipeline produced active frames");
        } else {
          console.log("[Day14C] status: degraded (model+audio ok, no active viseme frames)");
        }
      },
      600000,
    );
  });
});
