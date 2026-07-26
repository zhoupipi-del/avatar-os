import { describe, expect, it } from "vitest";

import { readDemoBrainConfig } from "./brain-factory";

describe("readDemoBrainConfig", () => {
  it("uses rule mode when explicitly requested", () => {
    const config = readDemoBrainConfig({
      VITE_AVATAROS_BRAIN_MODE: "rule",
    });

    expect(config.mode).toBe("rule");
  });

  it("uses ollama mode by default", () => {
    const config = readDemoBrainConfig({});

    expect(config.mode).toBe("ollama");
    expect(config.ollama.baseUrl).toBe("http://127.0.0.1:11434");
    expect(config.ollama.model).toBe("qwen2.5:7b");
    expect(config.ollama.timeoutMs).toBe(60000);
  });

  it("reads Ollama endpoint model and timeout from env", () => {
    const config = readDemoBrainConfig({
      VITE_AVATAROS_BRAIN_MODE: "ollama",
      VITE_OLLAMA_ENDPOINT: "http://localhost:11434/",
      VITE_OLLAMA_MODEL: "qwen2.5:14b",
      VITE_OLLAMA_TIMEOUT_MS: "45000",
    });

    expect(config.mode).toBe("ollama");
    expect(config.ollama.baseUrl).toBe("http://localhost:11434/");
    expect(config.ollama.model).toBe("qwen2.5:14b");
    expect(config.ollama.timeoutMs).toBe(45000);
  });

  it("falls back to 60000ms for invalid timeout", () => {
    const config = readDemoBrainConfig({
      VITE_OLLAMA_TIMEOUT_MS: "bad-value",
    });

    expect(config.ollama.timeoutMs).toBe(60000);
  });

  it("clamps timeout to at least 1000ms", () => {
    const config = readDemoBrainConfig({
      VITE_OLLAMA_TIMEOUT_MS: "20",
    });

    expect(config.ollama.timeoutMs).toBe(1000);
  });
});
