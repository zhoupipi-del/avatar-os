import { describe, it, expect } from "vitest";
import {
  createInitialSnapshot,
  recordIntent,
  recordSpeech,
  recordAction,
  recordClip,
  recordMood,
} from "../src/agent-runtime-snapshot";

// 这些测试守护 v0.3.1.1 的核心纪律：
// 快照只"采集已有状态"，绝不创造/伪造任何值。
describe("AgentRuntimeSnapshot (v0.3.1.1 只读旁路监护仪)", () => {
  it("初始快照全 null，不预填任何状态", () => {
    const s = createInitialSnapshot();
    expect(s.cognition.lastIntent).toBeNull();
    expect(s.cognition.confidence).toBeNull();
    expect(s.cognition.speech).toBeNull();
    expect(s.behavior.currentAction).toBeNull();
    expect(s.behavior.currentClip).toBeNull();
    expect(s.avatar.animation).toBeNull();
    expect(s.avatar.mood).toBeNull();
    expect(s.timestamp).toBe(0);
  });

  it("recordIntent 只更新 lastIntent，不动 speech/confidence", () => {
    const s = createInitialSnapshot();
    const next = recordIntent(s, "GREET");
    expect(next.cognition.lastIntent).toBe("GREET");
    expect(next.cognition.speech).toBeNull();
    expect(next.cognition.confidence).toBeNull(); // 引擎不产出 → 永不伪造
    expect(next.timestamp).toBeGreaterThan(0);
  });

  it("recordClip 同源驱动 behavior.currentClip 与 avatar.animation", () => {
    const s = createInitialSnapshot();
    const next = recordClip(s, "NlaTrack.001");
    expect(next.behavior.currentClip).toBe("NlaTrack.001");
    expect(next.avatar.animation).toBe("NlaTrack.001"); // 非 null 即视为 playing
  });

  it("confidence 在一次完整链路写入后仍为 null（不创造状态）", () => {
    let s = createInitialSnapshot();
    s = recordIntent(s, "GREET");
    s = recordSpeech(s, "你好，我在这里");
    s = recordAction(s, "GREET");
    s = recordClip(s, "NlaTrack.001");
    s = recordMood(s, "HAPPY");
    expect(s.cognition.confidence).toBeNull();
  });

  it("写入函数是纯的：不修改入参快照", () => {
    const s = createInitialSnapshot();
    const next = recordMood(s, "CALM");
    expect(s.avatar.mood).toBeNull(); // 原对象未变
    expect(next.avatar.mood).toBe("CALM"); // 返回新对象
    expect(next).not.toBe(s);
  });
});
