/**
 * walk-cycle —— 程序化走路步态（不需要走路动画文件）
 *
 * 叠加在当前 VRMA 姿态之上（premultiply，父空间旋转），所以待机动画的手臂下垂、身体姿态都保留，
 * 只额外加上：大腿前后交替摆动、迈步腿的膝盖弯曲、手臂与同侧腿反向摆动、身体轻微左右扭。
 *
 * 约定（VRM 1.0 归一化骨骼，模型面朝 +Z）：绕 +X 旋转 = 肢体向后。VRM 0.x 归一化坐标 X/Z 相反，用 flip=-1。
 */
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

export interface GaitPose {
  readonly upperLegL: number;
  readonly upperLegR: number;
  readonly lowerLegL: number;
  readonly lowerLegR: number;
  readonly upperArmL: number;
  readonly upperArmR: number;
  readonly spineYaw: number;
}

export const REST_GAIT: GaitPose = { upperLegL: 0, upperLegR: 0, lowerLegL: 0, lowerLegR: 0, upperArmL: 0, upperArmR: 0, spineYaw: 0 };

/**
 * 某一相位的步态角度（弧度）。phase 每 2π 为一个完整步伐周期（左右各迈一步）；amount 0~1 为步态强度（起步 / 收步渐变）。
 * 正值 = 向后（膝盖弯曲时小腿向后折）。
 */
export function gaitAt(phase: number, amount: number): GaitPose {
  const a = Math.max(0, Math.min(1, amount));
  if (a === 0) return REST_GAIT;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const swing = 0.42 * a;
  return {
    // 左腿 = swing*s：s>0 时向后；右腿相反
    upperLegL: swing * s,
    upperLegR: -swing * s,
    // 腿向前迈（角度在减小，即 c<0 对左腿）时膝盖弯曲；着地支撑时伸直
    lowerLegL: 0.75 * a * Math.max(0, -c),
    lowerLegR: 0.75 * a * Math.max(0, c),
    // 手臂与同侧腿反向
    upperArmL: -0.32 * a * s,
    upperArmR: 0.32 * a * s,
    spineYaw: 0.06 * a * s,
  };
}

/** 步频（Hz）：随移动速度线性变化，55 逻辑像素/秒 ≈ 每秒 1.7 步 */
export function stepFrequencyHz(speedLogical: number): number {
  return Math.max(0.8, Math.min(2.4, 1.7 * (speedLogical / 55)));
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();

type BoneName = Parameters<VRM["humanoid"]["getNormalizedBoneNode"]>[0];
type Saved = Array<[THREE.Object3D, THREE.Quaternion]>;

function rotate(vrm: VRM, bone: BoneName, axis: THREE.Vector3, angle: number, saved: Saved): void {
  if (angle === 0) return;
  const node = vrm.humanoid.getNormalizedBoneNode(bone);
  if (!node) return;
  saved.push([node, node.quaternion.clone()]);
  tmpQ.setFromAxisAngle(axis, angle);
  node.quaternion.premultiply(tmpQ);
}

/**
 * 把步态叠加到 VRM 当前姿态上（在 AnimationManager.tick 之后、vrm.update 之前调用）。
 * 返回叠加前的骨骼姿态，下一帧开头用 restoreGait 撤销——否则没被待机动画驱动的骨骼会每帧累加、越转越歪。
 */
export function applyGait(vrm: VRM, pose: GaitPose): Saved {
  const saved: Saved = [];
  if (pose === REST_GAIT) return saved;
  const flip = vrm.meta?.metaVersion === "0" ? -1 : 1;
  rotate(vrm, "leftUpperLeg", AXIS_X, flip * pose.upperLegL, saved);
  rotate(vrm, "rightUpperLeg", AXIS_X, flip * pose.upperLegR, saved);
  rotate(vrm, "leftLowerLeg", AXIS_X, flip * pose.lowerLegL, saved);
  rotate(vrm, "rightLowerLeg", AXIS_X, flip * pose.lowerLegR, saved);
  rotate(vrm, "leftUpperArm", AXIS_X, flip * pose.upperArmL, saved);
  rotate(vrm, "rightUpperArm", AXIS_X, flip * pose.upperArmR, saved);
  rotate(vrm, "spine", AXIS_Y, pose.spineYaw, saved);
  return saved;
}

/** 撤销上一帧的步态叠加（逆序恢复） */
export function restoreGait(saved: Saved): void {
  for (let i = saved.length - 1; i >= 0; i -= 1) {
    const [node, q] = saved[i]!;
    node.quaternion.copy(q);
  }
  saved.length = 0;
}

/**
 * 步态状态机：每帧推进相位，起步 / 收步时强度平滑过渡（约 0.3 秒），避免一下子"弹"进走路姿势。
 */
export class GaitDriver {
  private phase = 0;
  private amount = 0;

  update(walking: boolean, speedLogical: number, delta: number): GaitPose {
    const target = walking ? 1 : 0;
    const k = Math.min(1, delta / 0.3);
    this.amount += (target - this.amount) * k;
    if (this.amount < 0.01 && !walking) {
      this.amount = 0;
      this.phase = 0;
      return REST_GAIT;
    }
    this.phase += delta * Math.PI * 2 * stepFrequencyHz(speedLogical || 55);
    return gaitAt(this.phase, this.amount);
  }

  isActive(): boolean {
    return this.amount > 0;
  }
}

/** 走路时身体转向行进方向（3/4 侧身，脸仍朝向屏幕一些），停下转回正面 */
export function facingYaw(direction: -1 | 0 | 1): number {
  return direction * Math.PI * 0.36;
}
