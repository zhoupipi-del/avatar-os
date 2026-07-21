// ============================================================
// @avatar-os/morphology — 肢体运动学 (limb kinematics)
// ============================================================
// 纯函数层：把"输入信号"(鼠标/SVG 坐标、打字强度、拖拽加速度、系统状态)
// 翻译为"肢体关节角"(度)。不依赖 DOM / React，便于单测与未来扩展。
//
// 渲染层(Avatar.tsx)负责采集 DOM 信号并调用本模块，结果经
// VisualFrame.limbAngles 流入 Arms/Legs 组件的内联 rotate ——
// 与现有 CSS motion 类系统嵌套共存、互不覆盖。
//
// 坐标约定：SVG viewBox = "0 0 120 155"，y 轴向下。旋转角以"度"为单位，
// 正角 = 顺时针(因 y 向下)，0 = 静息。

export interface Point {
  x: number;
  y: number;
}

export interface LimbAngles {
  /** 左肩旋转(度, 0=静息) */
  armL: number;
  /** 右肩旋转 */
  armR: number;
  /** 左髋旋转 */
  legL: number;
  /** 右髋旋转 */
  legR: number;
}

export const REST_LIMB_ANGLES: LimbAngles = { armL: 0, armR: 0, legL: 0, legR: 0 };

/** SVG viewBox 0 0 120 155 中的关节支点 */
export const SHOULDER_L: Point = { x: 22, y: 48 };
export const SHOULDER_R: Point = { x: 98, y: 48 };
export const HIP_L: Point = { x: 42, y: 106 };
export const HIP_R: Point = { x: 78, y: 106 };

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

// 静息姿态下手臂相对"正下方"的偏角(度)：手臂自然外撇约 11°
const ARM_REST_ANGLE = 11;

// ============================================================
// F1: 鼠标引力 —— 手随光标 IK 够指针
// ============================================================

/**
 * 计算单臂为"指向光标"所需的旋转角(度)。
 * @param shoulder 肩支点(SVG 坐标)
 * @param cursor   光标位置(SVG 坐标)
 * @param side     左/右臂(静息外撇方向不同)
 * @param maxReach 最大旋转幅度, 防止手臂转满圈
 */
export function computeArmReachAngle(
  shoulder: Point,
  cursor: Point,
  opts: { maxReach?: number; side?: "L" | "R" } = {},
): number {
  const maxReach = opts.maxReach ?? 75;
  const restAngle = opts.side === "R" ? ARM_REST_ANGLE : -ARM_REST_ANGLE;
  const dx = cursor.x - shoulder.x;
  // dy 取较大下限, 避免光标正好在肩部高度时 atan2 跳变
  const dy = Math.max(cursor.y - shoulder.y, -1e6);
  const target = (Math.atan2(dx, dy) * 180) / Math.PI;
  const delta = target - restAngle;
  return clamp(delta, -maxReach, maxReach);
}

/** 屏幕 client 坐标 → SVG 120x155 坐标 */
export function clientToSvg(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Point {
  const w = rect.width || 1;
  const h = rect.height || 1;
  return {
    x: ((clientX - rect.left) / w) * 120,
    y: ((clientY - rect.top) / h) * 155,
  };
}

// ============================================================
// F2: 键盘同步 —— 打字时小手在胸前虚空打字
// ============================================================

/** 由近 1s 内按键数推导打字强度 [0..1] (20 键/s ≈ 满负荷) */
export function typingIntensityFromRate(keysPerSecond: number): number {
  return clamp(keysPerSecond / 20, 0, 1);
}

/** 打字姿态目标角：双臂抬到身前, 叠加随强度/时间抖动的"敲击" */
export function typingPose(intensity: number, tMs: number): LimbAngles {
  if (intensity <= 0.01) return { ...REST_LIMB_ANGLES };
  const jitter = Math.sin(tMs / 70) * 14 * intensity; // 高频小幅抖动
  const raise = 135 * intensity; // 抬手幅度随强度增大
  return {
    armL: -raise + jitter,
    armR: raise + jitter,
    legL: 0,
    legR: 0,
  };
}

/** 停手/思考姿态：一只手慢悠悠抬到头侧挠头 */
export function scratchHeadPose(tMs: number): LimbAngles {
  const slow = Math.sin(tMs / 600) * 8;
  return { armL: -150 + slow, armR: 0, legL: 0, legR: 0 };
}

// ============================================================
// F3: 布娃娃拖拽 —— 弹簧物理(Hooke)惯性晃荡
// ============================================================

export interface SpringState {
  angle: number;
  vel: number;
}

export const ZERO_SPRING: SpringState = { angle: 0, vel: 0 };

/**
 * 单步弹簧积分。accel 为拖拽加速度(肢体受的"甩动"力), k 刚度, c 阻尼。
 * 采用半隐式欧拉 + dt 钳制, 防止大步长数值爆炸。
 */
export function stepSpring(
  s: SpringState,
  accel: number,
  dt: number,
  k = 90,
  c = 9,
): SpringState {
  const dtc = Math.min(Math.max(dt, 0), 0.05);
  const force = -k * s.angle - c * s.vel + accel;
  const vel = s.vel + force * dtc;
  const angle = s.angle + vel * dtc;
  return { angle: clamp(angle, -60, 60), vel };
}

/** 由连续拖拽位移差分推导"甩动加速度"(差分), 缩放到合理角度加速度 */
export function dragAccelFromDelta(
  prevDelta: number,
  curDelta: number,
  dt: number,
): number {
  if (dt <= 0) return 0;
  const jerk = (curDelta - prevDelta) / dt; // 位移变化率
  return clamp(jerk / 4000, -40, 40);
}

// ============================================================
// F4: 系统状态映射 —— 全绿欢呼 / 报错抱头
// ============================================================

export type SystemStatus = "idle" | "success" | "error";

export function systemStatusToLimbs(status: SystemStatus, tMs: number): LimbAngles {
  switch (status) {
    case "success": {
      const cheer = Math.abs(Math.sin(tMs / 200)) * 12; // 上下挥动
      return { armL: -155 - cheer, armR: 155 + cheer, legL: 0, legR: 0 };
    }
    case "error": {
      const shake = Math.sin(tMs / 90) * 6; // 瑟瑟发抖
      return { armL: -168 + shake, armR: 168 - shake, legL: 0, legR: 0 };
    }
    default:
      return { ...REST_LIMB_ANGLES };
  }
}

// ============================================================
// 合成：多路肢体角叠加(带优先级覆盖)
// ============================================================

export function composeLimbAngles(parts: {
  reach?: LimbAngles;
  typing?: LimbAngles;
  ragdoll?: LimbAngles;
  status?: LimbAngles;
}): LimbAngles {
  const out: LimbAngles = { ...REST_LIMB_ANGLES };
  if (parts.reach) {
    out.armL += parts.reach.armL;
    out.armR += parts.reach.armR;
  }
  if (parts.typing) {
    out.armL += parts.typing.armL;
    out.armR += parts.typing.armR;
  }
  if (parts.ragdoll) {
    out.armL += parts.ragdoll.armL;
    out.armR += parts.ragdoll.armR;
    out.legL += parts.ragdoll.legL;
    out.legR += parts.ragdoll.legR;
  }
  // 系统状态优先级最高：直接覆盖双臂(欢呼/抱头)
  if (parts.status) {
    out.armL = parts.status.armL;
    out.armR = parts.status.armR;
  }
  return {
    armL: clamp(out.armL, -175, 175),
    armR: clamp(out.armR, -175, 175),
    legL: clamp(out.legL, -45, 45),
    legR: clamp(out.legR, -45, 45),
  };
}
