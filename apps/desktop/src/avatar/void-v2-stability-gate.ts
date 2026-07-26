/**
 * VOID V2 Runtime Stability Gate
 *
 * 在 DEV 模式下对 VRM 皮肤运行时状态做一次性真实性校验。
 * 只接受 Skin 层**实时真实可提炼**的数据（vrm 引用 + actionNames），
 * 不接受硬编码伪造的 productBodyIds / defaultBodyId 让 Gate 自证通过。
 *
 * 检查项：
 *   1. 静态配置合法性（calibration + motion semantics）
 *   2. Gaze distribution 权重和为 1
 *   3. stability.maxDeltaSeconds > 0
 *   4. 必要 normalized bones 存在（head / neck / spine / chest）
 *   5. VRM LookAt 已禁用（target=null + autoUpdate=false）
 *   6. 全部 8 个 VOID motion 已注册
 *   7. productBodyIds 只含 void-vrm（如提供）
 *   8. defaultBodyId 必须为 void-vrm（如提供）
 */

import type { VRM } from "@pixiv/three-vrm";
import {
  VOID_CALIBRATION,
  validateVoidCalibration,
} from "./void-calibration";
import {
  VOID_MOTION_SEMANTICS,
  validateVoidMotionSemantics,
} from "./void-motion-semantics";

export interface VoidV2RuntimeGateInput {
  /** 运行时 VRM 实例引用 */
  readonly vrm: VRM;

  /** 当前已注册的动作名列表（来自 profile actions config 的 keys） */
  readonly actionNames: readonly string[];

  /** 可选：产品可见身体 id 列表（如提供，必须只含 void-vrm） */
  readonly productBodyIds?: readonly string[];

  /** 可选：默认身体 id（如提供，必须为 void-vrm） */
  readonly defaultBodyId?: string;
}

export interface VoidV2GateIssue {
  readonly code: string;
  readonly message: string;
  readonly detail?: unknown;
}

export interface VoidV2GateResult {
  readonly passed: boolean;
  readonly issues: readonly VoidV2GateIssue[];
}

const REQUIRED_BONES = ["head", "neck", "spine", "chest"] as const;
const REQUIRED_VOID_MOTIONS = Object.keys(VOID_MOTION_SEMANTICS);

/**
 * 校验 VRM 运行时状态，返回所有发现的问题。
 * 不抛异常——调用方决定如何处理。
 */
export function validateVoidV2RuntimeGate(
  input: VoidV2RuntimeGateInput,
): VoidV2GateResult {
  const issues: VoidV2GateIssue[] = [];

  // ── 1. 静态配置合法性 ──
  try {
    validateVoidCalibration();
  } catch (err) {
    issues.push({
      code: "STATIC_CONFIG_INVALID",
      message: "Void calibration config is invalid",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    validateVoidMotionSemantics();
  } catch (err) {
    issues.push({
      code: "MOTION_SEMANTICS_INVALID",
      message: "Void motion semantics config is invalid",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 2. Gaze distribution 权重和 ──
  const { head, neck, spine } = VOID_CALIBRATION.gaze.distribution;
  const distributionSum = head + neck + spine;
  if (Math.abs(distributionSum - 1) > 0.0001) {
    issues.push({
      code: "GAZE_DISTRIBUTION_SUM",
      message: `Gaze distribution must sum to 1; received ${distributionSum}`,
    });
  }

  // ── 3. maxDeltaSeconds 必须 > 0 ──
  if (!(VOID_CALIBRATION.stability.maxDeltaSeconds > 0)) {
    issues.push({
      code: "MAX_DELTA_SECONDS_INVALID",
      message: `stability.maxDeltaSeconds must be > 0; received ${VOID_CALIBRATION.stability.maxDeltaSeconds}`,
    });
  }

  // ── 4. 必要 normalized bones 存在 ──
  for (const boneName of REQUIRED_BONES) {
    const node = input.vrm.humanoid?.getNormalizedBoneNode?.(boneName);
    if (!node) {
      issues.push({
        code: "BONE_MISSING",
        message: `Required normalized bone missing: ${boneName}`,
      });
    }
  }

  // ── 5. VRM LookAt 必须禁用 ──
  const lookAt = input.vrm.lookAt;
  if (lookAt) {
    if (lookAt.target !== null) {
      issues.push({
        code: "LOOKAT_TARGET_ACTIVE",
        message:
          "vrm.lookAt.target must be null (additive gaze overlay mode)",
      });
    }
    if (lookAt.autoUpdate !== false) {
      issues.push({
        code: "LOOKAT_AUTOUPDATE_ENABLED",
        message: "vrm.lookAt.autoUpdate must be false",
      });
    }
  }

  // ── 6. 全部 VOID motion 已注册 ──
  const actionSet = new Set(input.actionNames);
  for (const motion of REQUIRED_VOID_MOTIONS) {
    if (!actionSet.has(motion)) {
      issues.push({
        code: "ACTION_NOT_REGISTERED",
        message: `VOID motion not registered in actionNames: ${motion}`,
      });
    }
  }

  // ── 7. productBodyIds 只含 void-vrm（如提供）──
  if (input.productBodyIds) {
    for (const bodyId of input.productBodyIds) {
      if (bodyId !== "void-vrm") {
        issues.push({
          code: "LEGACY_BODY_VISIBLE",
          message: `productBodyIds contains non-void-vrm body: ${bodyId}`,
        });
      }
    }
  }

  // ── 8. defaultBodyId 必须为 void-vrm（如提供）──
  if (
    input.defaultBodyId !== undefined &&
    input.defaultBodyId !== "void-vrm"
  ) {
    issues.push({
      code: "DEFAULT_BODY_NOT_VOID",
      message: `defaultBodyId must be "void-vrm"; received "${input.defaultBodyId}"`,
    });
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

/**
 * 断言 Gate 通过，失败时抛出包含所有问题的 Error。
 */
export function assertVoidV2RuntimeGate(
  input: VoidV2RuntimeGateInput,
): void {
  const result = validateVoidV2RuntimeGate(input);
  if (!result.passed) {
    throw new Error(formatVoidV2GateResult(result));
  }
}

/**
 * 将 Gate 结果格式化为可读字符串。
 */
export function formatVoidV2GateResult(
  result: VoidV2GateResult,
): string {
  const lines: string[] = [
    `[VOID V2 Gate] ${result.passed ? "PASSED" : "FAILED"} (${result.issues.length} issue${result.issues.length === 1 ? "" : "s"})`,
  ];

  for (const issue of result.issues) {
    lines.push(`  - [${issue.code}] ${issue.message}`);
    if (issue.detail !== undefined) {
      lines.push(`    detail: ${issue.detail}`);
    }
  }

  return lines.join("\n");
}
