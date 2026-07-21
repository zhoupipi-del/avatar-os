import { kernelEventBus } from "../event-bus";
import { Mood, PhysicalIntentType, PhysicalPrimitive, PrimitiveCommand } from "@avatar-os/primitives";
import { AnimationManager } from "./animation-manager";
import { ExpressionController, moodToExpression } from "./expression-interface";
import { EmbodimentRuntime, type AvatarLifeState, type PrimitiveBindings } from "./embodiment-runtime";
import type { AvatarCapabilities } from "./capabilities";

/** 桥接层依赖：身体已知映射 + 能力图谱 + 当前生命状态供给 + 气泡回调 */
export interface BehaviorBridgeDeps {
  bindings: PrimitiveBindings;
  capability: AvatarCapabilities;
  getLife: () => AvatarLifeState;
  onSpeech?: (text: string) => void;
}

/**
 * 神经网桥：Behavior VM Adapter
 *
 * 连接 kernelEventBus（神经总线）与 3D 渲染层的核心桥梁。
 * 它监听意图 / 情绪 / 系统状态，然后指挥 AnimationManager 与 ExpressionController 干活。
 *
 * 这是「Cognition → Behavior VM → Animation」全链路闭环的最后一段：
 *   Behavior VM(仲裁器) ──PHYSICAL_INTENT_DISPATCH──▶ 本桥
 *     └─ EmbodimentRuntime.compile() ─▶ PrimitiveCommand[] ─▶ 派发到动画/表情/气泡
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
    private embodiment: EmbodimentRuntime,
    private deps: BehaviorBridgeDeps,
  ) {}

  public connect(): void {
    const u1 = kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (intent) => {
      const type = (intent?.type as PhysicalIntentType) ?? "IDLE_BREATHE";
      const cmds = this.embodiment.compile(
        type,
        this.deps.getLife(),
        this.deps.bindings,
        this.deps.capability,
      );
      cmds.forEach((c) => this.dispatch(c));
    });

    const u2 = kernelEventBus.on("STATE_MOOD_CHANGED", (p) => {
      const mood = (p?.mood ?? Mood.CALM) as Mood;
      this.expression[moodToExpression(mood)]();
    });

    const u3 = kernelEventBus.on("SYSTEM_STATUS_CHANGED", (p) => {
      const status = (p?.status as string) ?? "idle";
      const clip = this.deps.bindings.statusClip[status];
      if (clip) this.animation.playOnce(clip);
    });

    this.unsubs.push(u1, u2, u3);
    console.log("[BehaviorVMAdapter 🌉] Bridge connected to EventBus.");
  }

  /** 把原子指令派发到具体执行器；身体不支持的 primitive 在此优雅忽略（面向能力编程） */
  private dispatch(cmd: PrimitiveCommand): void {
    switch (cmd.type) {
      case PhysicalPrimitive.PLAY_ANIMATION: {
        const clip = cmd.payload.clip as string | undefined;
        if (clip) this.animation.playOnce(clip);
        break;
      }
      case PhysicalPrimitive.SPEECH_BUBBLE: {
        const text = cmd.payload.text as string | undefined;
        if (text) this.deps.onSpeech?.(text);
        break;
      }
      case PhysicalPrimitive.BODY_LEAN: {
        const angleX = cmd.payload.angleXDeg as number | undefined;
        if (typeof angleX === "number") this.expression.lean(angleX);
        break;
      }
      case PhysicalPrimitive.HEAD_TILT: {
        const angleZ = cmd.payload.angleZDeg as number | undefined;
        if (typeof angleZ === "number") this.expression.tilt(angleZ);
        break;
      }
      // BLENDSHAPE_SET / MATERIAL_GLOW / COLOR_SHIFT / LOOK_AT：
      // 当前 bag-character MVP 由 ExpressionController 的脊椎姿态 + 材质染色覆盖(经 mood)，
      // 这些原子指令在此为"已知但不单独执行"的契约占位；换身体(如机器人 LED)时在此扩展。
      default:
        break;
    }
  }

  public disconnect(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }
}
