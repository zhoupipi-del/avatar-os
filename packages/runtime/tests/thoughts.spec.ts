import { describe, it, expect } from "vitest";
import { Mood, PhysicalIntentType } from "@avatar-os/primitives";
import { moodThought, intentThought, systemThought } from "../src/thoughts";

describe("moodThought — 情绪→想法气泡", () => {
  it("CURIOUS → 思考气泡", () => {
    expect(moodThought(Mood.CURIOUS)).toEqual({ emoji: "🤔", text: "咦，有意思~" });
  });
  it("HAPPY / PLAYFUL / EXCITED 均有正向反馈", () => {
    expect(moodThought(Mood.HAPPY)?.emoji).toBe("😊");
    expect(moodThought(Mood.PLAYFUL)?.emoji).toBe("😜");
    expect(moodThought(Mood.EXCITED)?.emoji).toBe("🤩");
  });
  it("SLEEPING / TIRED / LONELY / SAD / FOCUSED 均有对应台词", () => {
    expect(moodThought(Mood.SLEEPING)?.text).toContain("困");
    expect(moodThought(Mood.TIRED)?.text.length).toBeGreaterThan(0);
    expect(moodThought(Mood.LONELY)?.text.length).toBeGreaterThan(0);
    expect(moodThought(Mood.SAD)?.text.length).toBeGreaterThan(0);
    expect(moodThought(Mood.FOCUSED)?.text).toContain("认真");
  });
  it("CALM(静息)不冒泡 → null，避免刷屏", () => {
    expect(moodThought(Mood.CALM)).toBeNull();
  });
});

describe("intentThought — 意图→情绪反馈气泡", () => {
  it("带情绪的高阶意图有反馈", () => {
    expect(intentThought("GREET" as PhysicalIntentType)).toEqual({ emoji: "👋", text: "嗨！" });
    expect(intentThought("BOUNCE_HAPPY" as PhysicalIntentType)?.emoji).toBe("😆");
    expect(intentThought("PEEK" as PhysicalIntentType)?.text).toBe("偷偷看…");
    expect(intentThought("DOZE" as PhysicalIntentType)?.text).toContain("瞌睡");
  });
  it("纯动作意图不冒泡 → null", () => {
    expect(intentThought("IDLE_BREATHE" as PhysicalIntentType)).toBeNull();
    expect(intentThought("LOOK_AT_USER" as PhysicalIntentType)).toBeNull();
    expect(intentThought("STRETCH" as PhysicalIntentType)).toBeNull();
  });
});

describe("systemThought — 系统状态→播报气泡", () => {
  it("success / error 有播报", () => {
    expect(systemThought("success")).toEqual({ emoji: "🎉", text: "搞定啦！" });
    expect(systemThought("error")).toEqual({ emoji: "😣", text: "出错了…" });
  });
  it("idle 不冒泡 → null", () => {
    expect(systemThought("idle")).toBeNull();
  });
});
