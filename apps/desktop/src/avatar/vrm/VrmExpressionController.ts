/**
 * VRM 表情控制器 — 实现 @avatar-os/runtime 的 ExpressionController 接口
 *
 * 分层设计:
 *   VRMA 动作        → 身体骨骼动画（AnimationManager 驱动）
 *   Emotion State    → happy / sad / relaxed / surprised 表情（V2: 权重走 VOID_CALIBRATION.presets）
 *   BlinkController  → 眨眼
 *   gazeBus + LookAt → 眼神跟随
 *   SpringBone       → 头发和服装摆动
 *
 * canWrite 使用真实 BodyChannelAuthority 两参数 API:
 *   authority.canWrite({ bone: spine.name, property: "rotation" }, "expression")
 *   返回 "ALLOW" | "YIELD"（不是布尔值）
 *
 * V2 合并：面部 BlendShape 权重从 VOID_CALIBRATION.expression.presets 读入，
 * 保留 canWrite 闸门 / lean()/tilt() / chest/head 写入 / 构造器结构。
 */

import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type {
  ExpressionController,
  ChannelProperty,
} from "@avatar-os/runtime";
import { VOID_CALIBRATION, type VoidExpressionName } from "../void-calibration";

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
  // ─── V2 面部权重：从 VOID_CALIBRATION.presets 读入 ───
  private readonly facialTargets: Record<VrmFace, number> = {
    happy: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0,
  };
  private readonly facialCurrent: Record<VrmFace, number> = {
    happy: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0,
  };

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

    // 初始表情 = idle 预设
    this.setPreset("idle");
  }

  // ─── 内部：面部预设切换 ───

  private setPreset(name: VoidExpressionName): void {
    const preset = VOID_CALIBRATION.expression.presets[name];
    this.facialTargets.happy = preset.happy;
    this.facialTargets.sad = preset.sad;
    this.facialTargets.relaxed = preset.relaxed;
    this.facialTargets.surprised = preset.surprised;
  }

  // ─── ExpressionController 接口实现 ───

  public happy(): void {
    this.setPreset("happy");
    this.leanTarget = THREE.MathUtils.degToRad(-4);
    this.tiltTarget = THREE.MathUtils.degToRad(2);
  }

  public sad(): void {
    this.setPreset("sad");
    this.leanTarget = THREE.MathUtils.degToRad(7);
    this.tiltTarget = 0;
  }

  public thinking(): void {
    this.setPreset("thinking");
    this.leanTarget = 0;
    this.tiltTarget = THREE.MathUtils.degToRad(8);
  }

  public drowsy(): void {
    this.setPreset("drowsy");
    this.leanTarget = THREE.MathUtils.degToRad(9);
    this.tiltTarget = THREE.MathUtils.degToRad(3);
  }

  public idle(): void {
    this.setPreset("idle");
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
   * 更新顺序（保留原有 canWrite 闸门 + V2 面部权重插值）:
   *   1. expressionManager BlendShape 写入（需 authority 允许）
   *   2. chest rotation.x = lean（需 authority 允许）
   *   3. head rotation.z = tilt（需 authority 允许）
   */
  public update(delta: number): void {
    const safeDelta = THREE.MathUtils.clamp(
      delta,
      0,
      VOID_CALIBRATION.stability.maxDeltaSeconds,
    );
    const alpha = 1 - Math.exp(-safeDelta * VOID_CALIBRATION.expression.response);

    // 表情 BlendShape（V2: 从 facialCurrent 逐面 lerp 到 facialTargets）
    if (
      this.canWrite(
        { bone: "expression", property: "morphTargetInfluences" as ChannelProperty },
        "expression",
      ) === "ALLOW"
    ) {
      if (VOID_CALIBRATION.features.calibratedExpression) {
        const manager = this.vrm.expressionManager;

        if (manager) {
          for (const face of FACES) {
            this.facialCurrent[face] = THREE.MathUtils.lerp(
              this.facialCurrent[face],
              this.facialTargets[face],
              alpha,
            );
            manager.setValue(face, this.facialCurrent[face]);
          }
        }
      }
    }

    // 躯干前后倾（chest/spine rotation.x，canWrite 闸门保留）
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

    // 头部侧倾（head rotation.z，canWrite 闸门保留）
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
}
