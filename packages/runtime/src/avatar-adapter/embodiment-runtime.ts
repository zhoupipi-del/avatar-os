// ============================================================
// EmbodimentRuntime — 具身翻译引擎 (Intent → PrimitiveCommand[])
// ============================================================
// 这是大脑(BehaviorVM) 与身体(渲染/硬件) 之间的"编译器"：
//   宏观意图(Intent) + 生命状态(LifeState/情绪/感知) + 身体能力(Capabilities)
//   → 原子表现指令数组(PrimitiveCommand[])
//
// 设计纪律（与用户共同拍板）：
// 1. Fallback 用「有序候选链」，不用权重计分。
//    - 每组候选取第一个满足身体能力的(降级)，组间全部收集；
//    - selection 确定性(argmax)，产品行为可预期(挥手就是挥手，不会 60%波/40%倾)；
//    - 用户在 220×220 窗肉眼标定，显式优先级 = 调一行顺序，计分 = 翻哪个权重算错。
// 2. weight 只用于执行强度调制(低能量衰减)，不参与"选哪个"。
// 3. 片段名查「身体已知映射(bindings=RigConfig)」，绝不字符串猜 "wave" ——
//    真实 bag-character 片段是 NlaTrack.001，猜名会静默落空。
//
// 落点：本类在 packages/runtime(avatar-adapter)，因需碰 THREE/能力扫描；
// 它是现有 MorphologyEngine(2D 翻译层) 的 3D 推广，不另起平行包。

import {
  EmotionalState,
  LifeState,
  PhysicalIntentType,
  PhysicalPrimitive,
  PrimitiveCommand,
} from "@avatar-os/primitives";
import type { UserPresence } from "@avatar-os/sensor";
import type { AvatarCapabilities } from "./capabilities";

/**
 * 身体已知映射（由皮肤把 RigConfig 结构性传入）。
 * 只取 EmbodimentRuntime 需要的最小子集，避免 runtime 反向依赖桌面 app。
 */
export interface PrimitiveBindings {
  idleClip: string;
  /** 物理意图类型 → 片段名（近似映射，按真实动作标定） */
  intentClip: Record<string, string>;
  /** 系统状态 → 片段名 */
  statusClip: Record<string, string>;
  /** 姿态表情用的脊椎骨骼名（无脸模型靠它"演"情绪） */
  spineBone: string;
}

/** 感知子集（从 sensor.UserPresence 派生，避免 runtime→sensor 重耦合细节） */
export interface AvatarPresence {
  userNearby: boolean;
  isFocused: boolean;
}

/** 编译期的全局生命状态聚合（复用现有 LifeState + EmotionalState + 派生感知） */
export interface AvatarLifeState {
  life: LifeState;
  emotion: EmotionalState;
  presence: AvatarPresence;
}

/** 从 sensor.UserPresence 派生本层需要的感知子集 */
export function presenceFromSensor(p: UserPresence): AvatarPresence {
  return {
    userNearby: p.level > 0.05,
    isFocused: p.focusState === "FOCUSED",
  };
}

// ---- 编译上下文与候选 ----
interface CompileCtx {
  intent: PhysicalIntentType;
  life: AvatarLifeState;
  bindings: PrimitiveBindings;
  cap: AvatarCapabilities;
}

/** 单个候选：给定上下文，命中身体能力则返回一条 primitive，否则 null(落空进入降级) */
type Candidate = (ctx: CompileCtx) => PrimitiveCommand | null;

/** 意图计划：每组是有序候选链(取第一个非 null = 降级)，组间全部收集 */
interface IntentPlan {
  groups: Candidate[][];
}

function cmd(type: PhysicalPrimitive, payload: Record<string, unknown>, weight: number): PrimitiveCommand {
  return { type, payload, weight };
}

// ---- 候选工厂（读 bindings/cap/life，不猜名字）----
const clipFor =
  (intentType: PhysicalIntentType) =>
  (ctx: CompileCtx): PrimitiveCommand | null => {
    const clip = ctx.bindings.intentClip[intentType];
    if (clip && ctx.cap.availableAnimations.includes(clip)) {
      return cmd(PhysicalPrimitive.PLAY_ANIMATION, { clip }, 1.0);
    }
    return null; // 片段不存在 → 落空，进入下一条候选(姿态降级)
  };

const leanFor =
  (bone: string, angleXDeg: number) =>
  (ctx: CompileCtx): PrimitiveCommand | null => {
    if (ctx.cap.supportedBones.includes(bone)) {
      return cmd(PhysicalPrimitive.BODY_LEAN, { bone, angleXDeg }, 0.8);
    }
    return null;
  };

const tiltFor =
  (bone: string, angleZDeg: number) =>
  (ctx: CompileCtx): PrimitiveCommand | null => {
    if (ctx.cap.supportedBones.includes(bone)) {
      return cmd(PhysicalPrimitive.HEAD_TILT, { bone, angleZDeg }, 0.6);
    }
    return null;
  };

const blendshapeFor =
  (shape: string) =>
  (ctx: CompileCtx): PrimitiveCommand | null => {
    if (ctx.cap.hasBlendShapes && ctx.cap.availableBlendShapes.includes(shape)) {
      return cmd(PhysicalPrimitive.BLENDSHAPE_SET, { shape, value: ctx.life.emotion.valence }, 1.0);
    }
    return null;
  };

const glowFor =
  (color: string) =>
  (ctx: CompileCtx): PrimitiveCommand | null => {
    if (ctx.cap.hasMaterialEmotion) {
      return cmd(PhysicalPrimitive.MATERIAL_GLOW, { color, intensity: ctx.life.emotion.valence }, 1.0);
    }
    return null;
  };

const speechFor = (text: string) => (): PrimitiveCommand =>
  cmd(PhysicalPrimitive.SPEECH_BUBBLE, { text }, 1.0);

// ---- 意图 → 计划 映射（数据驱动，新增意图/身体只改这里）----
const PLANS: Partial<Record<PhysicalIntentType, IntentPlan>> = {
  GREET: {
    groups: [
      [clipFor("GREET"), leanFor("Spine01", -10)], // 有挥手动画 → 播；否则脊椎后仰演"打招呼"
      [blendshapeFor("Smile"), glowFor("#FFAA00")], // 有脸 → 微笑；无脸 → 材质发光
      [speechFor("你回来啦！")], // 气泡总在
    ],
  },
  BOUNCE_HAPPY: {
    groups: [
      [clipFor("BOUNCE_HAPPY"), leanFor("Spine01", -8)],
      [blendshapeFor("Smile"), glowFor("#FFD21E")],
      [speechFor("好耶！")],
    ],
  },
  STRETCH: {
    groups: [[clipFor("STRETCH"), tiltFor("Head", 18)]],
  },
  DOZE: {
    groups: [[clipFor("DOZE"), tiltFor("Head", 30)]],
  },
  PEEK: {
    groups: [[clipFor("PEEK"), tiltFor("Head", 12)]],
  },
  // IDLE_BREATHE / LOOK_AT_USER 不在此列：
  // - idle 由 AnimationManager 常播；
  // - 视线追踪由 skin 层 global-mousemove → gazeBus → Head 骨接管，单一职责，不在此重复 emit。
};

/**
 * 具身翻译引擎（无状态，跨身体复用）。
 */
export class EmbodimentRuntime {
  /**
   * 把宏观意图翻译为身体可执行的原子指令数组。
   */
  public compile(
    intent: PhysicalIntentType,
    life: AvatarLifeState,
    bindings: PrimitiveBindings,
    cap: AvatarCapabilities,
  ): PrimitiveCommand[] {
    const plan = PLANS[intent];
    const ctx: CompileCtx = { intent, life, bindings, cap };
    const out: PrimitiveCommand[] = [];

    if (plan) {
      for (const group of plan.groups) {
        for (const cand of group) {
          const c = cand(ctx);
          if (c) {
            out.push(c);
            break; // 每组取第一个满足的(降级)
          }
        }
      }
    }

    this.applyOverlays(out, life);
    return out;
  }

  /**
   * 程序化叠加：基于生命状态调制执行权重（不影响选哪个 primitive）。
   * 低能量 → 所有动作权重按能量衰减，呈现"没力气"的沉睡感。
   */
  private applyOverlays(out: PrimitiveCommand[], life: AvatarLifeState): void {
    if (life.life.energy < 0.3) {
      const k = Math.max(0.1, life.life.energy);
      out.forEach((c) => {
        c.weight *= k;
      });
    }
  }
}
