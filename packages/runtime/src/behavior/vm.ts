// ============================================================
// Behavior VM — Step 字节码虚拟机 (v0.1.0-alpha Kernel Skeleton)
// ============================================================
// 设计原则：
//   - 这不是 Rule-Match 脚本（旧 behavior-vm.ts 的职责），
//     这是多 Step 的"行为脚本引擎"——每个 BehaviorInstance 持有固定 Step 队列，
//     驱动 LOOK→WAIT→SPEAK→GESTURE 的序列化编排。
//   - PAUSED / INTERRUPTED 是真状态——BehaviorVM 以外的任何模块
//     （如更高优先级 Sensor 事件、Idle 检测）都能触发暂停/恢复/打断。
//   - 每个 Step 产出零个或一个 PhysicalIntent，
//     最终由 AvatarKernel 仲裁后发射至 IntentRegistry(View)。
// ============================================================

import type { PhysicalIntent } from "@avatar-os/primitives";
import { makeIntent } from "@avatar-os/primitives";
import { phaseDefaultIntent } from "../life/life-phase";

// ------- BehaviorStatus 状态机 -------

export enum BehaviorStatus {
  CREATED = "CREATED",         // 已实例化，尚未启动
  RUNNING = "RUNNING",         // 正常步进中
  PAUSED = "PAUSED",           // 被低优先级外部事件暂停（可恢复）
  INTERRUPTED = "INTERRUPTED", // 被高优先级事件强行打断（不可恢复，需重新 enter）
  FINISHED = "FINISHED",       // 所有 Step 执行完毕，自然终止
}

// ------- BehaviorStep 字节码指令 -------

export type BehaviorOp = "LOOK" | "MOVE" | "WAIT" | "SPEAK" | "GESTURE";

export interface BehaviorStep {
  op: BehaviorOp;
  /** 该 Step 在 LOOK/MOVE 时的目标意图类型 */
  intentType?: string;
  /** 步进表达式参数 */
  args?: Record<string, unknown>;
  /** 本步持续时间 (ms)，WAIT 必须指定，其他可选 */
  durationMs?: number;
}

// ------- ComplexBehaviorDSL —— 行为蓝图 -------

export interface ComplexBehaviorDSL {
  id: string;
  name: string;
  /** 基础抢占优先级 (0-100) */
  basePriority: number;
  /** 冷却时间 (ms)，超过后才允许再次进入 */
  cooldownMs: number;
  /** 判断当前生命状态是否允许触发 */
  condition?: (state: any) => boolean;
  /** Step 字节码序列（enter 时被 BehaviorInstance 一次性加载为队列） */
  steps: BehaviorStep[];
}

// ------- BehaviorInstance —— 运行时行为实例 -------

export class BehaviorInstance {
  public status: BehaviorStatus = BehaviorStatus.CREATED;
  public readonly dsl: ComplexBehaviorDSL;
  private steps: BehaviorStep[];
  private stepIndex = 0;
  private stepElapsed = 0;
  private lastTriggeredAt = 0;

  constructor(dsl: ComplexBehaviorDSL) {
    this.dsl = dsl;
    this.steps = [...dsl.steps];
  }

  /** 进入行为：复位 Step 迭代器，置 RUNNING */
  public enter(): PhysicalIntent {
    this.stepIndex = 0;
    this.stepElapsed = 0;
    this.status = BehaviorStatus.RUNNING;
    this.lastTriggeredAt = Date.now();
    return this.getCurrentStepIntent();
  }

  /** 每帧 / 每 tick 推进 Step 字节码 */
  public update(deltaMs: number): boolean {
    if (this.status !== BehaviorStatus.RUNNING) return this.status !== BehaviorStatus.FINISHED;

    const step = this.steps[this.stepIndex];
    if (!step) {
      this.status = BehaviorStatus.FINISHED;
      return false;
    }

    this.stepElapsed += deltaMs;

    if (step.durationMs && this.stepElapsed >= step.durationMs) {
      this.stepIndex++;
      this.stepElapsed = 0;

      if (this.stepIndex >= this.steps.length) {
        this.status = BehaviorStatus.FINISHED;
        return false; // 自然退出
      }
    }

    return true;
  }

  /** 暂停：低优先级事件触发，保留当前 Step 位置与进度 */
  public pause(): void {
    if (this.status === BehaviorStatus.RUNNING) {
      this.status = BehaviorStatus.PAUSED;
    }
  }

  /** 恢复：从 PAUSED 继续 Step 位置 */
  public resume(): void {
    if (this.status === BehaviorStatus.PAUSED) {
      this.status = BehaviorStatus.RUNNING;
    }
  }

  /** 强行打断：不可恢复，需调用方重新 enter() */
  public interrupt(): void {
    if (this.status === BehaviorStatus.RUNNING || this.status === BehaviorStatus.PAUSED) {
      this.status = BehaviorStatus.INTERRUPTED;
    }
  }

  /** 获取当前 Step 产出的 PhysicalIntent */
  public getCurrentStepIntent(): PhysicalIntent {
    const step = this.steps[this.stepIndex];
    if (!step || step.op === "WAIT") {
      return makeIntent({ ...phaseDefaultIntent("idle"), source: "SYSTEM", priority: 0 });
    }
    const type = (step.intentType ?? "IDLE_BREATHE") as PhysicalIntent["type"];
    return makeIntent({
      type,
      intensity: (step.args?.intensity as number) ?? 0.8,
      priority: this.dsl.basePriority,
      source: "DRIVE",
      confidence: 1.0,
      durationMs: step.durationMs,
      payload: step.args,
    });
  }

  /** 是否已冷却完毕（距上次 enter 已过 cooldownMs） */
  public isCooldownPassed(): boolean {
    return Date.now() - this.lastTriggeredAt >= this.dsl.cooldownMs;
  }
}
