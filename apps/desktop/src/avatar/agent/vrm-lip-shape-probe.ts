/**
 * vrm-lip-shape-probe — Day6 LipSync Probe（只读探测，不驱动嘴型）
 *
 * 仅探测 VRM 是否具备 a/i/u/e/o 五个元音口型 blendshape，把结果暴露为可展示状态，
 * 为后续 Day7 No-op Harness / Day8 真实 LipSyncEngine 做前置闸门。
 *
 * 设计约束（BOSS 拍板，Day6 范围锁死）：
 *  - 只读：只通过 expressionManager.getExpression(name) / expressionMap / expressions 判断存在性
 *  - 绝不调用 setValue / getValue 写入任何表情权重（不驱动嘴型）
 *  - 不接 AudioContext、不接 Viseme 时间轴、不做完整 LipSyncEngine
 */

export type LipVowel = "a" | "i" | "u" | "e" | "o";

export interface LipShapeProbeResult {
  /** 是否存在任意口型 blendshape（可用于后续 LipSync） */
  readonly available: boolean;
  /** 缺失的元音（未找到任何候选口型名） */
  readonly missing: LipVowel[];
  /** 实际探测到的口型表达式名（去重） */
  readonly availableShapes: string[];
  /** 每个元音命中的实际表达式名（未命中为 null） */
  readonly perVowel: Record<LipVowel, string | null>;
}

/** three-vrm VRMExpressionManager 的最小可读接口（避免硬编码 three-vrm 依赖） */
export interface VrmExpressionManagerLike {
  getExpression?(name: string): unknown;
  expressionMap?: Record<string, unknown>;
  expressions?: Array<{ name?: string | null }>;
}

/** VRM 实例的最小可读接口 */
export interface VrmLike {
  expressionManager?: VrmExpressionManagerLike | null;
}

/** 每个元音的候选口型表达式名（按优先级，three-vrm 标准名优先） */
const VOWEL_CANDIDATES: Readonly<Record<LipVowel, readonly string[]>> = {
  a: ["aa", "a", "A", "mouth_a", "mouthA"],
  i: ["ih", "i", "I", "mouth_i", "mouthI"],
  u: ["ou", "u", "U", "mouth_u", "mouthU"],
  e: ["ee", "e", "E", "mouth_e", "mouthE"],
  o: ["oh", "o", "O", "mouth_o", "mouthO"],
};

const ALL_VOWELS: readonly LipVowel[] = ["a", "i", "u", "e", "o"];

function expressionExists(
  manager: VrmExpressionManagerLike,
  name: string,
): boolean {
  if (typeof manager.getExpression === "function") {
    try {
      if (manager.getExpression(name) != null) {
        return true;
      }
    } catch {
      // 某些实现下 getExpression 可能抛错，回退到 map / array 判断
    }
  }

  if (manager.expressionMap && typeof manager.expressionMap === "object") {
    if (Object.prototype.hasOwnProperty.call(manager.expressionMap, name)) {
      return true;
    }
  }

  if (Array.isArray(manager.expressions)) {
    return manager.expressions.some((expr) => expr?.name === name);
  }

  return false;
}

/**
 * 探测 VRM 的 a/i/u/e/o 口型 blendshape 是否存在。
 * 只读、无副作用；无 expressionManager 时返回 available=false。
 */
export function probeLipShapes(
  vrm: VrmLike | null | undefined,
): LipShapeProbeResult {
  const manager = vrm?.expressionManager ?? null;
  const perVowel: Record<LipVowel, string | null> = {
    a: null,
    i: null,
    u: null,
    e: null,
    o: null,
  };
  const availableShapes: string[] = [];

  if (!manager) {
    return {
      available: false,
      missing: [...ALL_VOWELS],
      availableShapes,
      perVowel,
    };
  }

  for (const vowel of ALL_VOWELS) {
    const found =
      VOWEL_CANDIDATES[vowel].find((name) =>
        expressionExists(manager, name),
      ) ?? null;
    perVowel[vowel] = found;
    if (found && !availableShapes.includes(found)) {
      availableShapes.push(found);
    }
  }

  const missing = ALL_VOWELS.filter((vowel) => perVowel[vowel] === null);

  return {
    available: availableShapes.length > 0,
    missing,
    availableShapes,
    perVowel,
  };
}
