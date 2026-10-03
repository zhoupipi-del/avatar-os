import { describe, expect, it, vi } from "vitest";
import {
  DesktopWalker,
  STROLL_MAX_LOGICAL,
  STROLL_MIN_LOGICAL,
  planStroll,
  stepToward,
  type WindowPort,
} from "./desktop-walker";
import { gaitAt, GaitDriver, REST_GAIT, facingYaw } from "../avatar/vrm/walk-cycle";
import {
  customMotionRegistry,
  describeCustomMotionsForPrompt,
  isCustomMotion,
  parseCustomMotionManifest,
  pickIdleMotion,
} from "../avatar/custom-motions";
import { normalizeMotionField, parseBrainJsonOutput } from "../avatar/agent/brain-json-parser";
import { AgentRuntime } from "../avatar/agent/agent-runtime";
import type { AgentBodyBridge } from "../avatar/agent/agent-intent";
import { buildChatSystemPrompt } from "./persona";
import { defaultSettingsFromEnv } from "./companion-settings";

const AREA = { x: 0, y: 0, width: 1920, height: 1040 }; // 1080 屏，任务栏 40
const SIZE = { width: 360, height: 460 };

describe("planStroll", () => {
  it("stays inside the work area and walks a sensible distance", () => {
    for (let i = 0; i < 200; i++) {
      const r = (i * 0.618) % 1;
      const pos = { x: Math.round(r * (AREA.width - SIZE.width)), y: 500 };
      const plan = planStroll(pos, SIZE, AREA, 1, () => r);
      if (!plan) continue;
      expect(plan.toX).toBeGreaterThanOrEqual(AREA.x);
      expect(plan.toX + SIZE.width).toBeLessThanOrEqual(AREA.x + AREA.width);
      const dist = Math.abs(plan.toX - plan.fromX);
      expect(dist).toBeLessThanOrEqual(STROLL_MAX_LOGICAL + 1);
      expect(Math.sign(plan.toX - plan.fromX)).toBe(plan.direction);
    }
  });

  it("walks away from the edge it is pressed against", () => {
    expect(planStroll({ x: 0, y: 500 }, SIZE, AREA, 1, () => 0.1)!.direction).toBe(1);
    expect(planStroll({ x: AREA.width - SIZE.width, y: 500 }, SIZE, AREA, 1, () => 0.9)!.direction).toBe(-1);
  });

  it("scales distances on high-DPI screens and refuses when there is no room", () => {
    const plan = planStroll({ x: 1000, y: 0 }, SIZE, { ...AREA, width: 3840 }, 2, () => 0)!;
    expect(Math.abs(plan.toX - plan.fromX)).toBeGreaterThanOrEqual(STROLL_MIN_LOGICAL * 2);
    expect(planStroll({ x: 0, y: 0 }, SIZE, { x: 0, y: 0, width: 400, height: 800 }, 1)).toBeNull();
  });

  it("pulls y back inside the work area (never under the taskbar)", () => {
    expect(planStroll({ x: 500, y: 900 }, SIZE, AREA, 1, () => 0.3)!.y).toBe(AREA.height - SIZE.height);
  });
});

describe("stepToward", () => {
  it("moves at speed and snaps on arrival", () => {
    expect(stepToward(0, 100, 50, 1)).toEqual({ x: 50, arrived: false });
    expect(stepToward(90, 100, 50, 1)).toEqual({ x: 100, arrived: true });
    expect(stepToward(100, 0, 50, 0.5)).toEqual({ x: 75, arrived: false });
  });
});

function fakePort(start = { x: 800, y: 300 }) {
  const moves: Array<[number, number]> = [];
  const port: WindowPort = {
    getPosition: async () => start,
    getSize: async () => SIZE,
    getWorkArea: async () => AREA,
    setPosition: async (x, y) => void moves.push([x, y]),
    scaleFactor: async () => 1,
  };
  return { port, moves };
}

describe("DesktopWalker", () => {
  it("waits before the first stroll, then walks to the target and stops", async () => {
    let t = 0;
    const bus = { walking: false, direction: 0 as -1 | 0 | 1, speed: 0 };
    const { port, moves } = fakePort();
    const w = new DesktopWalker({ port, canWalk: () => true, now: () => t, rng: () => 0.99, bus, frameMs: 1e9 });
    await w.check();
    expect(w.isWalking()).toBe(false); // 启动后先等一会儿
    t += 4 * 60_000;
    await w.check();
    expect(w.isWalking()).toBe(true);
    expect(bus).toMatchObject({ walking: true, direction: 1 });
    for (let i = 0; i < 200 && w.isWalking(); i++) {
      t += 100;
      await w.frame();
    }
    expect(w.isWalking()).toBe(false);
    expect(bus.walking).toBe(false);
    const xs = moves.map((m) => m[0]);
    expect(xs.every((x, i) => i === 0 || x >= xs[i - 1]!)).toBe(true); // 单调向右
    expect(moves.every((m) => m[1] === 300)).toBe(true); // 高度不变
    w.stop();
  });

  it("stops immediately when she interacts or the companion gets busy", async () => {
    let t = 10 * 60_000;
    let allowed = true;
    const bus = { walking: false, direction: 0 as -1 | 0 | 1, speed: 0 };
    const w = new DesktopWalker({ port: fakePort().port, canWalk: () => allowed, now: () => t, rng: () => 0.5, bus, frameMs: 1e9 });
    expect(await w.strollNow()).toBe(true);
    allowed = false; // 比如开始说话
    t += 33;
    await w.frame();
    expect(w.isWalking()).toBe(false);
    expect(bus.walking).toBe(false);

    allowed = true;
    expect(await w.strollNow()).toBe(true);
    w.interrupt(); // 她按下鼠标
    expect(w.isWalking()).toBe(false);
    w.stop();
  });

  it("does not walk when the switch is off or the work area is unknown", async () => {
    const t = 60 * 60_000;
    const off = new DesktopWalker({ port: fakePort().port, canWalk: () => false, now: () => t, frameMs: 1e9 });
    await off.check();
    expect(off.isWalking()).toBe(false);
    const noArea = new DesktopWalker({ port: { ...fakePort().port, getWorkArea: async () => null }, canWalk: () => true, now: () => t, frameMs: 1e9 });
    expect(await noArea.strollNow()).toBe(false);
  });

  it("gives up quietly if moving the window fails", async () => {
    const port = { ...fakePort().port, setPosition: vi.fn(async () => { throw new Error("denied"); }) };
    const w = new DesktopWalker({ port, canWalk: () => true, now: () => 1e9, frameMs: 1e9 });
    await w.strollNow();
    await w.frame();
    expect(w.isWalking()).toBe(false);
  });
});

describe("walk cycle", () => {
  it("legs and arms alternate, knees only bend backwards", () => {
    for (let p = 0; p < Math.PI * 2; p += 0.3) {
      const g = gaitAt(p, 1);
      expect(g.upperLegL).toBeCloseTo(-g.upperLegR);
      expect(Math.sign(g.upperArmL) * Math.sign(g.upperLegL)).toBeLessThanOrEqual(0); // 手与同侧腿反向
      expect(g.lowerLegL).toBeGreaterThanOrEqual(0);
      expect(g.lowerLegR).toBeGreaterThanOrEqual(0);
    }
    expect(gaitAt(1, 0)).toBe(REST_GAIT);
  });

  it("eases in and out instead of snapping", () => {
    const d = new GaitDriver();
    const first = d.update(true, 55, 1 / 30);
    expect(Math.abs(first.upperLegL)).toBeLessThan(0.1);
    for (let i = 0; i < 60; i++) d.update(true, 55, 1 / 30);
    expect(d.isActive()).toBe(true);
    for (let i = 0; i < 120; i++) d.update(false, 0, 1 / 30);
    expect(d.update(false, 0, 1 / 30)).toBe(REST_GAIT);
  });

  it("turns toward the walking direction, faces front when standing", () => {
    expect(facingYaw(1)).toBeGreaterThan(0);
    expect(facingYaw(-1)).toBeLessThan(0);
    expect(facingYaw(0)).toBe(0);
  });
});

describe("custom motions manifest", () => {
  it("accepts valid entries and rejects unsafe / clashing ones with reasons", () => {
    const r = parseCustomMotionManifest({
      motions: [
        { id: "heart", file: "heart.vrma", label: "比心", when: "开心的时候", idleWeight: 0 },
        { id: "GREET", file: "g.vrma" },
        { id: "EVIL", file: "../../avatar.vrm" },
        { id: "x", file: "x.vrma" },
        { id: "HEART", file: "again.vrma" },
        { id: "LAZY", file: "lazy.vrma", idleWeight: 99 },
      ],
    });
    expect(r.motions.map((m) => m.id)).toEqual(["HEART", "LAZY"]);
    expect(r.motions[1]!.idleWeight).toBe(10);
    expect(r.skipped).toHaveLength(4);
    expect(parseCustomMotionManifest(null).motions).toEqual([]);
  });

  it("picks idle motions by weight and never picks weight-0 ones", () => {
    const ms = parseCustomMotionManifest({
      motions: [
        { id: "HEART", file: "a.vrma", idleWeight: 0 },
        { id: "STRETCH_ARMS", file: "b.vrma", idleWeight: 3 },
      ],
    }).motions;
    for (let r = 0; r < 1; r += 0.1) expect(pickIdleMotion(ms, () => r)!.id).toBe("STRETCH_ARMS");
    expect(pickIdleMotion([ms[0]!])).toBeNull();
  });

  it("appear in the chat prompt only when loaded, and the reply's motion is parsed", () => {
    const s = defaultSettingsFromEnv({});
    customMotionRegistry.motions = [];
    expect(buildChatSystemPrompt(s)).not.toContain("招牌动作");
    customMotionRegistry.motions = parseCustomMotionManifest({ motions: [{ id: "HEART", file: "h.vrma", label: "比心", when: "被夸时" }] }).motions;
    expect(buildChatSystemPrompt(s)).toContain("HEART：比心（被夸时）");
    expect(describeCustomMotionsForPrompt([])).toBe("");
    expect(isCustomMotion("heart")).toBe(true);
    customMotionRegistry.motions = [];

    const out = parseBrainJsonOutput('{"speech":"嘿嘿","intent":{"type":"GREET","intensity":0.5},"emotion":{"type":"happy","intensity":0.5},"motion":"heart"}');
    expect(out.motion).toBe("HEART");
    expect(normalizeMotionField("drop table")).toEqual({});
    expect(normalizeMotionField("NONE")).toEqual({});
  });
});

describe("AgentRuntime + signature motion", () => {
  const brainSaying = (motion?: string) => ({
    think: async () => ({ speech: "嘿", intent: { type: "GREET" as const, intensity: 0.5 }, emotion: { type: "happy" as const, intensity: 0.5 }, motion }),
  });

  it("plays the signature motion instead of the intent when the body has it", async () => {
    const body: AgentBodyBridge = { speakText: vi.fn(), setEmotion: vi.fn(), playIntent: vi.fn(), playMotion: vi.fn(() => true) };
    await new AgentRuntime(brainSaying("HEART"), body).receiveText("你真好");
    expect(body.playMotion).toHaveBeenCalledWith("HEART");
    expect(body.playIntent).not.toHaveBeenCalled();
  });

  it("falls back to the intent when the motion is unknown or absent", async () => {
    const body: AgentBodyBridge = { speakText: vi.fn(), setEmotion: vi.fn(), playIntent: vi.fn(), playMotion: vi.fn(() => false) };
    await new AgentRuntime(brainSaying("NOPE"), body).receiveText("hi");
    expect(body.playIntent).toHaveBeenCalledOnce();
    const plain: AgentBodyBridge = { speakText: vi.fn(), setEmotion: vi.fn(), playIntent: vi.fn() };
    await new AgentRuntime(brainSaying(), plain).receiveText("hi");
    expect(plain.playIntent).toHaveBeenCalledOnce();
  });
});
