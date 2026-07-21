import { kernelEventBus } from "../event-bus";
import { Mood, type PhysicalIntentType } from "@avatar-os/primitives";
import { AnimationManager } from "./animation-manager";
import { ExpressionController, moodToExpression } from "./expression-interface";

/** 桥接层用的映射表：把内核语义事件翻译为具体 GLB 片段名 */
export interface BehaviorBridgeMaps {
  idleClip: string;
  /** 物理意图类型 → 片段名（近似映射，需按真实动作标定） */
  intentClip: Record<string, string>;
  /** 系统状态 → 片段名 */
  statusClip: Record<string, string>;
}

/**
 * 神经网桥：Behavior VM Adapter
 *
 * 连接 kernelEventBus（神经总线）与 3D 渲染层的核心桥梁。
 * 它监听意图 / 情绪 / 系统状态，然后指挥 AnimationManager 与 ExpressionController 干活。
 *
 * 这是「Cognition → Behavior VM → Animation」全链路闭环的最后一段：
 *   Behavior VM(仲裁器) ──PHYSICAL_INTENT_DISPATCH──▶ 本桥 ──▶ AnimationManager.playOnce
 *   情绪内核 ──STATE_MOOD_CHANGED──▶ 本桥 ──▶ ExpressionController.姿势
 *   系统状态 ──SYSTEM_STATUS_CHANGED──▶ 本桥 ──▶ AnimationManager.playOnce
 *
 * 注意：本类与 packages/runtime 里已有的 BehaviorVM（发意图的仲裁器）职责不同——
 * 那个负责「产生意图」，这个负责「消费意图去驱动模型」。名字相近但互不替换。
 */
export class BehaviorVMAdapter {
  private unsubs: Array<() => void> = [];

  constructor(
    private animation: AnimationManager,
    private expression: ExpressionController,
    private maps: BehaviorBridgeMaps,
  ) {}

  public connect(): void {
    const u1 = kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (intent) => {
      const clip = this.maps.intentClip[(intent?.type as PhysicalIntentType) ?? ""];
      if (clip) this.animation.playOnce(clip);
    });

    const u2 = kernelEventBus.on("STATE_MOOD_CHANGED", (p) => {
      const mood = (p?.mood ?? Mood.CALM) as Mood;
      this.expression[moodToExpression(mood)]();
    });

    const u3 = kernelEventBus.on("SYSTEM_STATUS_CHANGED", (p) => {
      const clip = this.maps.statusClip[(p?.status as string) ?? "idle"];
      if (clip) this.animation.playOnce(clip);
    });

    this.unsubs.push(u1, u2, u3);
    console.log("[BehaviorVMAdapter 🌉] Bridge connected to EventBus.");
  }

  public disconnect(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }
}
