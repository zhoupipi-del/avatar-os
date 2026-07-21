import { PhysicalIntent, makeIntent } from "@avatar-os/primitives";
import { BehaviorVM, BehaviorRule, BehaviorLifecycle } from "./behavior-vm";

/**
 * 带时长的高阶意图生命周期：enter 派发意图，update 在 durationMs 内存活，
 * 超时自然退出（返回 false），由 BehaviorVM 复位至 IDLE_BREATHE。
 */
class TimedIntentLifecycle implements BehaviorLifecycle {
  private elapsed = 0;
  constructor(private intent: PhysicalIntent, private durationMs: number) {}

  enter(): PhysicalIntent {
    return this.intent;
  }

  update(deltaMs: number): boolean {
    this.elapsed += deltaMs;
    return this.elapsed < this.durationMs;
  }

  exit(): void {}
  interrupt(): void {}
}

/**
 * Day 1 默认行为规则集（占位基线，Day 3-4 按 Personality/Context 扩充）。
 * 仅表达「驱动力压力 → 物理意图」的最简映射，证明 BehaviorVM 端到端可驱动。
 */
export function registerDefaultRules(vm: BehaviorVM): void {
  const rules: BehaviorRule[] = [
    {
      id: "sleep-when-tired",
      name: "Low energy -> doze",
      basePriority: 40,
      cooldownMs: 60000,
      condition: (s) => s.energy < 0.25,
      createLifecycle: () => new TimedIntentLifecycle(makeIntent({ type: "DOZE", intensity: 1.0, source: "DRIVE" }), 8000),
    },
    {
      id: "greet-when-lonely",
      name: "High loneliness -> greet",
      basePriority: 50,
      cooldownMs: 30000,
      condition: (s) => s.pressures.lonelinessPressure > 0.7,
      createLifecycle: () => new TimedIntentLifecycle(makeIntent({ type: "GREET", intensity: 0.9, source: "DRIVE" }), 2500),
    },
    {
      // 蓝图验证场景：孤独压力越过 0.65 即试探性偷看（PEEK → CURIOUS）
      // 阈值低于 greet(0.7)，保证 30min 离场(lonely≈0.686)先触发 PEEK 而非 GREET。
      id: "peek-when-lonely",
      name: "Mid loneliness -> peek",
      basePriority: 45,
      cooldownMs: 20000,
      condition: (s) => s.pressures.lonelinessPressure > 0.65,
      createLifecycle: () => new TimedIntentLifecycle(makeIntent({ type: "PEEK", intensity: 0.7, source: "DRIVE" }), 1800),
    },
    {
      id: "rest-when-fatigued",
      name: "High fatigue -> stretch (relieve)",
      basePriority: 60,
      cooldownMs: 45000,
      condition: (s) => s.pressures.fatiguePressure > 0.7,
      createLifecycle: () => new TimedIntentLifecycle(makeIntent({ type: "STRETCH", intensity: 0.8, source: "DRIVE" }), 3000),
    },
  ];

  rules.forEach((r) => vm.registerRule(r));
}
