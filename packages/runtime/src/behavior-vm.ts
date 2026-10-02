import { PhysicalIntent, LifeState, makeIntent } from "@avatar-os/primitives";
import { phaseDefaultIntent, type LifePhase } from "./life/life-phase";
import { kernelEventBus } from "./event-bus";

export interface BehaviorLifecycle {
  enter(): PhysicalIntent;
  update(deltaMs: number): boolean; // 返回 false 代表自然退出
  exit(): void;
  interrupt(): void;
}

export interface BehaviorRule {
  id: string;
  name: string;
  basePriority: number; // 0 - 100
  cooldownMs: number;
  lastTriggeredAt?: number;
  condition: (state: LifeState) => boolean;
  createLifecycle: () => BehaviorLifecycle;
}

export class BehaviorVM {
  private rules: Map<string, BehaviorRule> = new Map();
  private activeCandidate: { ruleId: string; priority: number; lifecycle: BehaviorLifecycle } | null = null;
  /** 当前离散生命阶段（v0.3.5-A）：复位默认意图由阶段决定，替代硬编码 IDLE_BREATHE */
  private phase: LifePhase = "awake";

  public registerRule(rule: BehaviorRule): void {
    this.rules.set(rule.id, rule);
  }

  /** 设置当前离散生命阶段，使复位时的默认意图与阶段一致（v0.3.5-A）。 */
  public setPhase(phase: LifePhase): void {
    this.phase = phase;
  }

  /**
   * 候选行为生成 + Arbiter 抢占仲裁
   */
  public evaluate(state: LifeState): void {
    const now = Date.now();
    const candidates: { rule: BehaviorRule; priority: number }[] = [];

    for (const rule of this.rules.values()) {
      if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.cooldownMs) {
        continue;
      }
      if (rule.condition(state)) {
        candidates.push({ rule, priority: rule.basePriority });
      }
    }

    if (candidates.length === 0) return;

    // 按 Priority 降序仲裁
    candidates.sort((a, b) => b.priority - a.priority);
    const top = candidates[0];

    // 抢占式打断校验 (Preemption: 新行为优先级需高于当前行为 10 以上)
    if (!this.activeCandidate) {
      this.executeCandidate(top.rule);
    } else if (top.priority > this.activeCandidate.priority + 10) {
      console.log(`[Arbiter ⚡ Preemption] Interrupting ${this.activeCandidate.ruleId} -> ${top.rule.id}`);
      this.activeCandidate.lifecycle.interrupt();
      this.executeCandidate(top.rule);
    }
  }

  /**
   * 生命周期 Tick 推进
   */
  public tick(deltaMs: number): void {
    if (!this.activeCandidate) return;

    const isAlive = this.activeCandidate.lifecycle.update(deltaMs);
    if (!isAlive) {
      this.activeCandidate.lifecycle.exit();
      const rule = this.rules.get(this.activeCandidate.ruleId);
      if (rule) rule.lastTriggeredAt = Date.now();

      this.activeCandidate = null;

      // 自动复位至阶段驱动的默认意图（v0.3.5-A：替代硬编码 IDLE_BREATHE）
      kernelEventBus.emit(
        "PHYSICAL_INTENT_DISPATCH",
        makeIntent({ ...phaseDefaultIntent(this.phase), source: "SYSTEM" }),
      );
    }
  }

  private executeCandidate(rule: BehaviorRule): void {
    const lifecycle = rule.createLifecycle();
    this.activeCandidate = { ruleId: rule.id, priority: rule.basePriority, lifecycle };

    const intent = lifecycle.enter();
    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", intent);
  }
}

export const behaviorVM = new BehaviorVM();
