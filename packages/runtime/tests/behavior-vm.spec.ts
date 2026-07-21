// ============================================================
// BehaviorVM 单测基线 (R5)
// 锁定"抢占式仲裁"这一内核最关键的决策不变量：
//   - 同帧多候选 → 按 basePriority 降序胜出
//   - 更高优先级(差值>10) → 可抢占当前行为
//   - 低优先级(差值<=10) → 无法抢占
// 注意：behaviorVM.tick() 返回 void（意图经 kernelEventBus 下发），
// 本测试用生命周期 enter() 的副作用日志来验证仲裁结果，不依赖审计的
// 错误签名（它误以为 tick 返回 intent）。
// ============================================================
import { describe, expect, test } from "vitest";
import { BehaviorVM, BehaviorRule } from "../src/behavior-vm";
import { makeIntent, PhysicalIntentType, LifeState } from "@avatar-os/primitives";

function makeRule(
  id: string,
  priority: number,
  intent: PhysicalIntentType,
  log: string[],
): BehaviorRule {
  return {
    id,
    name: id,
    basePriority: priority,
    cooldownMs: 0,
    condition: () => true, // 恒真，便于隔离测试仲裁逻辑
    createLifecycle: () => ({
      enter: () => {
        log.push(intent);
        return makeIntent({ type: intent, intensity: 1, source: "SYSTEM" });
      },
      update: () => true,
      exit: () => {},
      interrupt: () => {},
    }),
  };
}

const dummyState = {} as LifeState;

describe("BehaviorVM — 抢占式仲裁", () => {
  test("同帧多候选按优先级降序仲裁", () => {
    const log: string[] = [];
    const vm = new BehaviorVM();
    vm.registerRule(makeRule("A", 20, "GREET", log));
    vm.registerRule(makeRule("B", 80, "PEEK", log));
    vm.evaluate(dummyState);
    expect(log.at(-1)).toBe("PEEK"); // 高优先级胜出
  });

  test("更高优先级可抢占当前行为(差值>10)", () => {
    const log: string[] = [];
    const vm = new BehaviorVM();
    // 先只注册 B(80)，使其先激活
    vm.registerRule(makeRule("B", 80, "PEEK", log));
    vm.evaluate(dummyState); // B 激活
    expect(log.at(-1)).toBe("PEEK");
    // 再注册更高优先级 C(95)，应抢占 B
    vm.registerRule(makeRule("C", 95, "DOZE", log));
    vm.evaluate(dummyState); // C 抢占 B
    expect(log.at(-1)).toBe("DOZE");
  });

  test("低优先级无法抢占(差值<=10)", () => {
    const log: string[] = [];
    const vm = new BehaviorVM();
    vm.registerRule(makeRule("B", 80, "PEEK", log));
    vm.registerRule(makeRule("A", 70, "GREET", log)); // 80-70=10，不满足 >10
    vm.evaluate(dummyState); // B 激活
    expect(log.at(-1)).toBe("PEEK");
    vm.evaluate(dummyState); // A 无法抢占
    expect(log.at(-1)).toBe("PEEK");
  });

  test("无候选条件满足时保持静默(不报错、不派发)", () => {
    const log: string[] = [];
    const vm = new BehaviorVM();
    vm.registerRule({
      id: "X",
      name: "X",
      basePriority: 50,
      cooldownMs: 0,
      condition: () => false, // 永不触发
      createLifecycle: () => ({
        enter: () => {
          log.push("X");
          return makeIntent({ type: "GREET", intensity: 1, source: "SYSTEM" });
        },
        update: () => true,
        exit: () => {},
        interrupt: () => {},
      }),
    });
    vm.evaluate(dummyState);
    expect(log).toHaveLength(0);
  });
});
