import * as THREE from "three";
import { Mood } from "@avatar-os/primitives";

/**
 * 表情控制器统一接口。
 *
 * 不管底层是 3D 骨骼、Live2D 还是全息 LED 屏，统统实现这个接口 ——
 * 内核只认 ExpressionController，不认具体美术资产。
 * 这就是「面向接口编程，而不是面向美术资产编程」的落地点：
 * 没有面部 BlendShape 的模型，用「姿态/脊椎倾斜」向下兼容；
 * 有脸的模型，用「BlendShape」直出。二者对内核透明。
 */
export interface ExpressionController {
  /** 开心：昂首挺胸、略微后仰 */
  happy(): void;
  /** 低落：垂头蜷缩、脊椎前倾 */
  sad(): void;
  /** 思考：歪头 */
  thinking(): void;
  /** 困倦：深度下垂，模拟打瞌睡 */
  drowsy(): void;
  /** 平静：恢复自然直立 */
  idle(): void;
  /** 每帧推进：把目标姿态平滑 lerp 到骨骼上（由渲染层 useFrame 调用） */
  update(delta: number): void;
}

/** 语义表情方法名（不含 update） */
export type ExprMethod = "happy" | "sad" | "thinking" | "drowsy" | "idle";

/**
 * Mood 枚举 → 语义表情方法。
 * 内核的 10 种情绪收敛到 5 类可演姿态，无脸模型也能「演」出情绪。
 */
const MOOD_TO_EXPR: Record<Mood, ExprMethod> = {
  [Mood.HAPPY]: "happy",
  [Mood.EXCITED]: "happy",
  [Mood.PLAYFUL]: "happy",
  [Mood.SAD]: "sad",
  [Mood.LONELY]: "sad",
  [Mood.TIRED]: "drowsy",
  [Mood.SLEEPING]: "drowsy",
  [Mood.FOCUSED]: "thinking",
  [Mood.CURIOUS]: "thinking",
  [Mood.CALM]: "idle",
};

export function moodToExpression(m: Mood): ExprMethod {
  return MOOD_TO_EXPR[m] ?? "idle";
}

/**
 * 针对无面部 BlendShape 的骨骼模型（如 bag character）的降级实现：
 * 用脊椎骨骼(Spine01)的姿态倾斜来「演」情绪，向下兼容没有表情肌的模型。
 *
 * 设计要点：
 * - 每个语义方法只设定「目标欧拉角」，真正的旋转在 update() 里做帧率无关 lerp，
 *   避免一次性 set 导致的硬切；
 * - bone 缺失（某些模型无对应脊椎骨）时退化为 no-op，不报错。
 */
export class BagCharacterExpression implements ExpressionController {
  private target = new THREE.Euler(0, 0, 0);
  private current = new THREE.Euler(0, 0, 0);
  private hasBone: boolean;

  constructor(private bone: THREE.Object3D | null) {
    this.hasBone = !!bone;
  }

  public happy(): void {
    this.target.set(-0.2, 0, 0.03);
  }

  public sad(): void {
    this.target.set(0.4, 0, 0);
  }

  public thinking(): void {
    this.target.set(0, 0, 0.22);
  }

  public drowsy(): void {
    this.target.set(0.5, 0, 0);
  }

  public idle(): void {
    this.target.set(0, 0, 0);
  }

  public update(delta: number): void {
    if (!this.hasBone || !this.bone) return;
    // 帧率无关指数平滑：~8 的收敛速率
    const a = 1 - Math.exp(-delta * 8);
    this.current.x = THREE.MathUtils.lerp(this.current.x, this.target.x, a);
    this.current.y = THREE.MathUtils.lerp(this.current.y, this.target.y, a);
    this.current.z = THREE.MathUtils.lerp(this.current.z, this.target.z, a);
    this.bone.rotation.copy(this.current);
  }
}
