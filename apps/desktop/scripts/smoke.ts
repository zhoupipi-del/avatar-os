// 冒烟验证：直接跑真实 DriveEngine + BehaviorVM 源码，验证 v0.2.0-alpha 闭环数学。
import { DriveEngine } from "@avatar-os/runtime/src/drive-engine";
import { DEFAULT_PERSONALITY } from "@avatar-os/runtime/src/personality";
import { BehaviorVM } from "@avatar-os/runtime/src/behavior-vm";
import { registerDefaultRules } from "@avatar-os/runtime/src/behavior-rules";
import { kernelEventBus } from "@avatar-os/runtime/src/event-bus";
import { PhysicalIntent } from "@avatar-os/primitives";

type Presence = { level: number };

function runScenario(opts: { presenceLevel: number; bonus: number; minutes: number }) {
  const de = new DriveEngine();
  const vm = new BehaviorVM();
  registerDefaultRules(vm);

  let lastIntent: PhysicalIntent | null = null;
  let peekFired = false;
  const unbind = kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (i: PhysicalIntent) => {
    lastIntent = i;
    if (i.type === "PEEK") peekFired = true;
  });

  const presence: Presence = { level: opts.presenceLevel };
  const ticks = opts.minutes * 60;
  for (let i = 0; i < ticks; i++) {
    const { state } = de.tick(1000, presence as any, DEFAULT_PERSONALITY, opts.bonus);
    vm.evaluate(state);
    vm.tick(1000);
  }

  const finalState = de.getState();
  unbind();
  return { finalState, lastIntent, peekFired };
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("❌ FAIL:", msg);
    process.exit(1);
  }
  console.log("✅ PASS:", msg);
}

// 场景1：30min 离场，bonus=0.2 → 孤独压力应 > 0.65，且 Arbiter 选中 PEEK
{
  const { finalState, lastIntent, peekFired } = runScenario({ presenceLevel: 0, bonus: 0.2, minutes: 30 });
  const lp = finalState.pressures.lonelinessPressure;
  console.log(`  [场景1] socialNeed=${finalState.socialNeed.toFixed(3)} loneliness=${lp.toFixed(3)} lastIntent=${lastIntent?.type} peekFired=${peekFired}`);
  assert(lp > 0.65, `30min 离场孤独压力(${lp.toFixed(3)}) > 0.65`);
  assert(lp < 0.7, `30min 离场孤独压力(${lp.toFixed(3)}) < 0.7（先 PEEK 而非 GREET）`);
  assert(peekFired, `Arbiter 在孤独越界时选中 PEEK（peekFired=${peekFired}）`);
}

// 场景2：30min 离场，但记忆甜度 bonus=1.0 → 孤独被显著缓解，不应触发 PEEK
{
  const { finalState, peekFired } = runScenario({ presenceLevel: 0, bonus: 1.0, minutes: 30 });
  const lp = finalState.pressures.lonelinessPressure;
  console.log(`  [场景2] loneliness=${lp.toFixed(3)} peekFired=${peekFired}`);
  assert(lp < 0.65, `记忆甜度满时孤独压力(${lp.toFixed(3)}) < 0.65（O6 缓解生效）`);
  assert(!peekFired, `记忆甜度满时不触发 PEEK（peekFired=${peekFired}）`);
}

// 场景3：用户在场 level=1 → 孤独=0，好奇升高，不应触发孤独类行为
{
  const { finalState, lastIntent } = runScenario({ presenceLevel: 1, bonus: 0.0, minutes: 30 });
  const lp = finalState.pressures.lonelinessPressure;
  const cp = finalState.pressures.curiosityPressure;
  console.log(`  [场景3] loneliness=${lp.toFixed(3)} curiosity=${cp.toFixed(3)} intent=${lastIntent?.type}`);
  assert(lp === 0, `用户在场孤独压力 = 0`);
  assert(cp > 0.5, `用户在场好奇压力(${cp.toFixed(3)}) > 0.5（外向+开放被激活）`);
}

console.log("\n🎉 全部闭环数学验证通过");
