import { describe, expect, it } from "vitest";
import { ConversationMemory, type ConversationStorage, type ConversationTurn } from "./conversation-memory";

function memStorage(initial: ConversationTurn[] | null = null) {
  let data: ConversationTurn[] | null = initial;
  const storage: ConversationStorage = {
    load: () => data,
    save: (t) => {
      data = [...t];
    },
    clear: () => {
      data = null;
    },
  };
  return { storage, read: () => data };
}

describe("ConversationMemory", () => {
  it("appends turns in order and returns recent context", () => {
    const m = new ConversationMemory({ contextSize: 2 });
    m.append("user", "我叫小林", 1);
    m.append("assistant", "你好小林", 2);
    m.append("user", "我叫什么？", 3);
    expect(m.size()).toBe(3);
    expect(m.recent().map((t) => t.text)).toEqual(["你好小林", "我叫什么？"]);
  });

  it("ignores blank text and truncates long text", () => {
    const m = new ConversationMemory({ maxTextLength: 20 });
    m.append("user", "   ");
    m.append("user", "a".repeat(100));
    expect(m.size()).toBe(1);
    expect(m.all()[0]!.text.length).toBe(20);
  });

  it("caps stored turns at maxStored", () => {
    const m = new ConversationMemory({ maxStored: 4 });
    for (let i = 0; i < 10; i++) m.append("user", `m${i}`, i);
    expect(m.all().map((t) => t.text)).toEqual(["m6", "m7", "m8", "m9"]);
  });

  it("persists to and restores from storage", () => {
    const { storage, read } = memStorage();
    const a = new ConversationMemory({ storage });
    a.append("user", "记住我喜欢猫", 1);
    a.append("assistant", "好的，你喜欢猫", 2);
    expect(read()).toHaveLength(2);

    const b = new ConversationMemory({ storage });
    expect(b.recent().map((t) => t.text)).toEqual(["记住我喜欢猫", "好的，你喜欢猫"]);
  });

  it("drops corrupted stored entries and survives throwing storage", () => {
    const bad = [{ role: "user", text: "ok", at: 1 }, { role: "hacker", text: 1 }] as unknown as ConversationTurn[];
    const { storage } = memStorage(bad);
    expect(new ConversationMemory({ storage }).size()).toBe(1);

    const throwing: ConversationStorage = {
      load: () => {
        throw new Error("boom");
      },
      save: () => {
        throw new Error("quota");
      },
    };
    const m = new ConversationMemory({ storage: throwing });
    expect(() => m.append("user", "hi")).not.toThrow();
    expect(m.size()).toBe(1);
  });

  it("clear() wipes memory and storage", () => {
    const { storage, read } = memStorage();
    const m = new ConversationMemory({ storage });
    m.append("user", "x");
    m.clear();
    expect(m.size()).toBe(0);
    expect(read()).toBeNull();
  });
});
