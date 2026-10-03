/**
 * expression-synth —— 让「任何来源」的 VRM 都能眨眼、对口型、做表情
 *
 * 程序的眨眼 / 嘴型 / 表情都通过 VRM 标准表情名驱动（blink、aa/ih/ou/ee/oh、happy/sad…）。
 * VRoid 导出的模型自带这些；但照片生成的写实模型（MetaPerson 等）、Blender 自制模型
 * 常常只有 ARKit 52 面部变形（eyeBlinkLeft、jawOpen…）或 viseme_aa 这类口型变形，
 * 没登记成 VRM 标准表情——结果是嘴不动、不眨眼。
 *
 * 这里在加载后扫描模型自带的变形，按配方拼出缺失的标准表情并注册到 expressionManager，
 * 之后整条眨眼 / 嘴型 / 表情管线无需任何改动即可工作。已存在且有效的标准表情一律不碰。
 */
import type * as THREE from "three";
import {
  VRMExpression,
  VRMExpressionManager,
  VRMExpressionMorphTargetBind,
  type VRM,
} from "@pixiv/three-vrm";

/** 程序会用到的标准表情 */
export const NEEDED_EXPRESSIONS = [
  "blink", "blinkLeft", "blinkRight",
  "aa", "ih", "ou", "ee", "oh",
  "happy", "sad", "angry", "relaxed", "surprised",
] as const;
export type NeededExpression = (typeof NEEDED_EXPRESSIONS)[number];

interface Part {
  /** 变形名候选（会做归一化：小写、去掉符号和常见前缀后按结尾匹配） */
  readonly names: readonly string[];
  readonly weight: number;
  /** 可选部件：找不到也不影响这个配方成立 */
  readonly optional?: boolean;
}
type Recipe = readonly Part[];

const p = (names: string | string[], weight = 1, optional = false): Part => ({
  names: Array.isArray(names) ? names : [names],
  weight,
  optional,
});

/** 每个标准表情的配方，按优先级排列：先用专门的口型 / 眨眼变形，再用 ARKit 组合 */
export const EXPRESSION_RECIPES: Record<NeededExpression, readonly Recipe[]> = {
  blink: [
    [p(["blink", "eyesclosed", "eyeclose", "blinkboth"])],
    [p(["eyeblinkleft", "eyeblinkl", "blinkleft", "blinkl"]), p(["eyeblinkright", "eyeblinkr", "blinkright", "blinkr"])],
  ],
  blinkLeft: [[p(["eyeblinkleft", "eyeblinkl", "blinkleft", "blinkl"])]],
  blinkRight: [[p(["eyeblinkright", "eyeblinkr", "blinkright", "blinkr"])]],
  aa: [[p(["visemeaa", "vaa", "visemea", "mouthaa"])], [p("jawopen", 0.7), p("mouthfunnel", 0.15, true)]],
  ih: [[p(["visemeih", "visemei", "vih"])], [p("jawopen", 0.3), p("mouthstretchleft", 0.45, true), p("mouthstretchright", 0.45, true)]],
  ou: [[p(["visemeou", "visemeu", "vou"])], [p("mouthpucker", 0.9), p("jawopen", 0.15, true)]],
  ee: [[p(["visemeee", "visemee", "vee"])], [p("jawopen", 0.3), p("mouthsmileleft", 0.45, true), p("mouthsmileright", 0.45, true)]],
  oh: [[p(["visemeoh", "visemeo", "voh"])], [p("mouthfunnel", 0.8), p("jawopen", 0.4, true)]],
  happy: [[p("mouthsmileleft", 0.8), p("mouthsmileright", 0.8), p("cheeksquintleft", 0.4, true), p("cheeksquintright", 0.4, true)]],
  sad: [[p("mouthfrownleft", 0.7), p("mouthfrownright", 0.7), p("browinnerup", 0.7, true)]],
  angry: [[p("browdownleft", 0.8), p("browdownright", 0.8), p("mouthpressleft", 0.4, true), p("mouthpressright", 0.4, true)]],
  relaxed: [[p("mouthsmileleft", 0.35), p("mouthsmileright", 0.35), p("eyesquintleft", 0.3, true), p("eyesquintright", 0.3, true)]],
  surprised: [[p("browinnerup", 0.8), p("eyewideleft", 0.6, true), p("eyewideright", 0.6, true), p("jawopen", 0.35, true)]],
};

/** 变形名归一化：「blendShape1.eyeBlinkLeft」「ARKit_EyeBlink_L」→ 小写、只留字母数字 */
export function normalizeMorphName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface MorphHit {
  readonly mesh: THREE.Mesh;
  readonly index: number;
}

/** 收集模型里所有带变形的网格：归一化名字 → 命中位置（同名变形可能分布在脸、牙齿、舌头等多个网格上） */
export function collectMorphTargets(root: THREE.Object3D): Map<string, MorphHit[]> {
  const out = new Map<string, MorphHit[]>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const dict = mesh.morphTargetDictionary;
    if (!dict || !mesh.morphTargetInfluences) return;
    for (const [name, index] of Object.entries(dict)) {
      const key = normalizeMorphName(name);
      const list = out.get(key) ?? [];
      list.push({ mesh, index });
      out.set(key, list);
    }
  });
  return out;
}

/** 在已收集的变形里找一个部件：优先完全相等，其次「以候选名结尾」（兼容各种前缀） */
function findPart(morphs: Map<string, MorphHit[]>, part: Part): MorphHit[] | null {
  for (const cand of part.names) {
    const exact = morphs.get(cand);
    if (exact?.length) return exact;
  }
  for (const cand of part.names) {
    if (cand.length < 5) continue; // 太短的名字（如 vaa）只接受完全相等，避免误配
    for (const [key, hits] of morphs) {
      if (key.endsWith(cand)) return hits;
    }
  }
  return null;
}

export interface SynthReport {
  /** 模型原本就有的标准表情 */
  readonly native: NeededExpression[];
  /** 由面部变形自动拼出来的 */
  readonly synthesized: NeededExpression[];
  /** 两者都没有，用不了 */
  readonly missing: NeededExpression[];
}

function hasUsable(manager: VRMExpressionManager | undefined, name: string): boolean {
  const e = manager?.getExpression(name);
  return !!e && e.binds.length > 0;
}

/**
 * 补全缺失的标准表情。会修改 vrm.expressionManager（没有时新建一个挂上）。
 * 只补缺：模型原有且有效的表情不动。
 */
export function synthesizeMissingExpressions(vrm: VRM): SynthReport {
  let manager = vrm.expressionManager;
  const native = NEEDED_EXPRESSIONS.filter((n) => hasUsable(manager, n));
  const morphs = collectMorphTargets(vrm.scene);
  const synthesized: NeededExpression[] = [];
  const missing: NeededExpression[] = [];

  for (const name of NEEDED_EXPRESSIONS) {
    if (native.includes(name)) continue;
    let built: VRMExpression | null = null;
    for (const recipe of EXPRESSION_RECIPES[name]) {
      const resolved = recipe.map((part) => ({ part, hits: findPart(morphs, part) }));
      if (resolved.some((r) => !r.part.optional && !r.hits)) continue;
      const expr = new VRMExpression(name);
      for (const { part, hits } of resolved) {
        if (!hits) continue;
        // 同一网格同一变形只绑一次
        const seen = new Set<string>();
        for (const h of hits) {
          const k = `${h.mesh.uuid}:${h.index}`;
          if (seen.has(k)) continue;
          seen.add(k);
          expr.addBind(new VRMExpressionMorphTargetBind({ primitives: [h.mesh], index: h.index, weight: part.weight }));
        }
      }
      if (expr.binds.length > 0) {
        built = expr;
        break;
      }
    }
    if (!built) {
      missing.push(name);
      continue;
    }
    if (!manager) {
      manager = new VRMExpressionManager();
      (vrm as unknown as { expressionManager: VRMExpressionManager }).expressionManager = manager;
    }
    const existing = manager.getExpression(name);
    if (existing) manager.unregisterExpression(existing);
    manager.registerExpression(built);
    synthesized.push(name);
  }
  return { native, synthesized, missing };
}
