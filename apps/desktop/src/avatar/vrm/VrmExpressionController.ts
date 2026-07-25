/**
 * VRM 表情控制器 — 实现 @avatar-os/runtime 的 ExpressionController 接口
 *
 * 分层设计:
 *   VRMA 动作        → 身体骨骼动画（AnimationManager 驱动）
 *   Emotion State    → happy / sad / relaxed / surprised 表情
 *   BlinkController  → 眨眼
 *   gazeBus + LookAt → 眼神跟随
 *   SpringBone       → 头发和服装摆动
 *
 * canWrite 使用真实 BodyChannelAuthority 两参数 API:
 *   authority.canWrite({ bone: spine.name, property: "rotation" }, "expression")
 *   返回 "ALLOW" | "YIELD"（不是布尔值）
 */

import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type {
  ExpressionController,
  ChannelProperty,
} from "@avatar-os/runtime";

type VrmFace =
  | "happy"
  | "sad"
  | "relaxed"
  | "surprised";

const FACES: readonly VrmFace[] = [
  "happy",
  "sad",
  "relaxed",
  "surprised",
];

export class VrmExpressionController
  implements ExpressionController
{
  private activeFace: VrmFace | null = null;
  private strength = 0;
  private targetStrength = 0;

  /** chest 或 spine 骨骼（用于 lean 前后倾） */
  private readonly chest: THREE.Object3D | null;

  /** head 骨骼（用于 tilt 侧倾/歪头） */
  private readonly head: THREE.Object3D | null;

  private leanTarget = 0;
  private tiltTarget = 0;

  /**
   * @param vrm - 目标 VRM 实例
   * @param canWrite - Authority 仲裁函数。签名:
   *   (channel: {bone:string, property:ChannelProperty}, owner: string) => "ALLOW"|"YIELD"
   */
  public constructor(
    private readonly vrm: VRM,
    private readonly canWrite: (
      channel: { bone: string; property: ChannelProperty },
      owner: "animation" | "expression" | "gaze" | "headTilt" | "breathing",
    ) => "ALLOW" | "YIELD",
  ) {
    // chest 优先，fallback 到 spine
    this.chest =
      vrm.humanoid.getNormalizedBoneNode("chest") ??
      vrm.humanoid.getNormalizedBoneNode("spine");

    this.head =
      vrm.humanoid.getNormalizedBoneNode("head");
  }

  // ─── ExpressionController 接口实现 ───

  public happy(): void {
    this.select("happy", 0.85);
  }

  public sad(): void {
    this.select("sad", 0.75);
  }

  public thinking(): void {
    this.select("relaxed", 0.28);
    this.tiltTarget = THREE.MathUtils.degToRad(7);
  }

  public drowsy(): void {
    this.select("relaxed", 0.55);
    this.leanTarget = THREE.MathUtils.degToRad(5);
  }

  public idle(): void {
    this.activeFace = null;
    this.targetStrength = 0;
    this.leanTarget = 0;
    this.tiltTarget = 0;
  }

  public lean(angleXDeg: number): void {
    this.leanTarget = THREE.MathUtils.degToRad(angleXDeg);
  }

  public tilt(angleZDeg: number): void {
    this.tiltTarget = THREE.MathUtils.degToRad(angleZDeg);
  }

  /**
   * 每帧调用。平滑 lerp 目标姿态到骨骼 + 写入 VRM BlendShape。
   *
   * 更新顺序（与 StandardAvatarSkin 一致）:
   *   1. strength lerp
   *   2. expressionManager 写入（需 authority 允许）
   *   3. chest rotation.x = lean（需 authority 允许）
   *   4. head rotation.z = tilt（需 authority 允许）
   */
  public update(delta: number): void {
    const alpha = 1 - Math.exp(-delta * 8);

    this.strength = THREE.MathUtils.lerp(
      this.strength,
      this.targetStrength,
      alpha,
    );

    // 表情 BlendShape
    if (
      this.canWrite(
        { bone: "expression", property: "morphTargetInfluences" as ChannelProperty },
        "expression",
      ) === "ALLOW"
    ) {
      const manager = this.vrm.expressionManager;

      if (manager) {
        for (const face of FACES) {
          if (manager.getExpression(face)) {
            manager.setValue(
              face,
              face === this.activeFace ? this.strength : 0,
            );
          }
        }
      }
    }

    // 躯干前后倾（chest/spine rotation.x）
    if (
      this.chest &&
      this.canWrite(
        { bone: this.chest.name, property: "rotation" },
        "expression",
      ) === "ALLOW"
    ) {
      this.chest.rotation.x = THREE.MathUtils.lerp(
        this.chest.rotation.x,
        this.leanTarget,
        alpha,
      );
    }

    // 头部侧倾（head rotation.z）
    if (
      this.head &&
      this.canWrite(
        { bone: this.head.name, property: "rotation" },
        "expression",
      ) === "ALLOW"
    ) {
      this.head.rotation.z = THREE.MathUtils.lerp(
        this.head.rotation.z,
        this.tiltTarget,
        alpha,
      );
    }
  }

  // ─── 内部 ───

  private select(face: VrmFace, strength: number): void {
    this.activeFace = face;
    this.targetStrength = strength;
  }
}
