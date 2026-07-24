// ============================================================
// Relationship State (v0.3.7-A) — 长期关系积累的数据模型
// ============================================================
// 关系层记录"我们之间发生过什么"（长期、可持久化）；
// 情绪层表示"它现在感觉如何"（短期）。二者语义严格区分：
//   RelationalTrust   → 长期关系基线，跨会话保存，变化缓慢
//   EmotionState.trust → 当前会话即时信任感，变化较快
// 使用不同字段名（relationalTrust vs trust）正是为了避免"双真相"冲突。
//
// 本文件是纯数据模型 + 纯函数，零总线 / 零 Tauri / 零文件依赖。
// ============================================================

import type { EmotionState } from "../emotion/emotion-state";

export const RELATIONSHIP_SCHEMA_VERSION = 1 as const;

/** 长期关系状态。连续值 relationalTrust/familiarity/attachment 均限制在 0..1。 */
export interface RelationshipState {
  /** 长期关系信任基线（跨会话保存，变化缓慢）。与 EmotionState.trust 语义不同，不可混淆。 */
  relationalTrust: number;
  /** 熟悉度：由重复互动与活跃天数积累。 */
  familiarity: number;
  /** 依恋：只从"跨会话、跨天"的关系形成，单个会话无法显著形成。 */
  attachment: number;

  /** 有效互动总次数（touch/speak/return 计数，不含自主动作）。 */
  interactionCount: number;
  /** 活跃天数（有互动的不同自然日数）。 */
  activeDays: number;

  /** 初次相遇时间戳(ms)。 */
  firstMetAt: number;
  /** 最近一次有效互动时间戳(ms，| null)。 */
  lastInteractionAt: number | null;
  /** 最近一次状态更新时间戳(ms)。 */
  lastUpdatedAt: number;

  /** 数据 schema 版本，用于迁移 / 安全回退。 */
  schemaVersion: 1;
}

/** 关系历史聚合（不保存聊天文本 / LLM 回复 / 对话全文 / 截图 / 隐私数据）。 */
export interface RelationshipHistory {
  conversationCount: number;
  touchCount: number;
  returnCount: number;
  meaningfulInteractionCount: number;

  /** 最近活跃自然日 key（YYYY-M-D），用于"跨日"判定。 */
  lastActiveDay: string | null;
  /** 会话数（同进程只计一次；真正应用重启才算新会话）。 */
  sessionCount: number;
}

/** 全新用户中性关系：连续值全归零，等待真实积累后才逐渐产生影响。 */
export const NEUTRAL_RELATIONSHIP: RelationshipState = {
  relationalTrust: 0,
  familiarity: 0,
  attachment: 0,
  interactionCount: 0,
  activeDays: 0,
  firstMetAt: 0,
  lastInteractionAt: null,
  lastUpdatedAt: 0,
  schemaVersion: RELATIONSHIP_SCHEMA_VERSION,
};

export const NEUTRAL_HISTORY: RelationshipHistory = {
  conversationCount: 0,
  touchCount: 0,
  returnCount: 0,
  meaningfulInteractionCount: 0,
  lastActiveDay: null,
  sessionCount: 0,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** 夹紧关系状态：连续值入 [0,1]；计数器 / 时间戳保持非负 / 原值。 */
export function clampRelationship(r: RelationshipState): RelationshipState {
  return {
    relationalTrust: clamp01(r.relationalTrust),
    familiarity: clamp01(r.familiarity),
    attachment: clamp01(r.attachment),
    interactionCount: r.interactionCount < 0 ? 0 : Math.max(0, Math.floor(r.interactionCount)),
    activeDays: r.activeDays < 0 ? 0 : Math.max(0, Math.floor(r.activeDays)),
    firstMetAt: r.firstMetAt ?? 0,
    lastInteractionAt: r.lastInteractionAt,
    lastUpdatedAt: r.lastUpdatedAt ?? 0,
    schemaVersion: RELATIONSHIP_SCHEMA_VERSION,
  };
}

/** 创建初始关系状态（可覆盖部分字段）。 */
export function createInitialRelationship(override?: Partial<RelationshipState>): RelationshipState {
  return clampRelationship({ ...NEUTRAL_RELATIONSHIP, ...(override ?? {}) });
}

/**
 * 关系 → 情绪基线（纯函数）。
 *
 * 硬约束：全新用户（中性关系，连续值全 0）→ 必须返回 NEUTRAL_EMOTION（全 0.5），
 * 即"加入关系层后首次启动行为完全不变"。因此公式以 0 为中心外推，绝不围绕绝对 0.5 做减法。
 *
 * 允许的影响（契约定）：
 *   - relationalTrust 高 → trust 恢复基线略高于中性
 *   - familiarity 高     → comfort 恢复基线略高于中性
 * 禁止（由调用方保证，不在本函数内）：
 *   - attachment 高 → 直接发 LOOK_AT_USER / GREET
 *   - trust 高     → 直接发 GREET
 *   - familiarity 高 → 强制修改 LifePhase
 * （attachment 的"离开 loneliness 升更快 / 回来 comfort 恢复更快"属于速率调制，
 *   由 EmotionEngine.setAttachmentModulation 处理，不在此基线内。）
 */
export function deriveEmotionBaseline(relationship: RelationshipState): EmotionState {
  const TRUST_WEIGHT = 0.3;
  const COMFORT_WEIGHT = 0.2;
  return {
    trust: clamp01(0.5 + relationship.relationalTrust * TRUST_WEIGHT),
    comfort: clamp01(0.5 + relationship.familiarity * COMFORT_WEIGHT),
    // loneliness / curiosity 的静止基线保持中性；attachment 动态由速率调制处理
    loneliness: 0.5,
    curiosity: 0.5,
  };
}
