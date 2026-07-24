// ============================================================
// Relationship Engine (v0.3.7-A) — 长期关系演化纯逻辑
// ============================================================
// 铁律（与 EmotionEngine / AutonomousScheduler 同纪律）：
//   - 零总线依赖、零 Tauri / 文件 / 浏览器依赖；
//   - 没有任何 emit / dispatch / 发意图的方法；
//   - 只维护 RelationshipState + RelationshipHistory，对外通过 getState() 暴露。
//
// 关系比情绪慢至少一个数量级：单次互动只产生极小增量，单日重复操作收益递减，
// attachment 只从跨会话 / 跨天关系形成，单个会话无法显著形成。
// ============================================================

import {
  RelationshipState,
  RelationshipHistory,
  NEUTRAL_RELATIONSHIP,
  NEUTRAL_HISTORY,
  clampRelationship,
} from "./relationship-state";

export type RelationshipInteractionKind = "touch" | "speak" | "return";

/** 焦点状态（与 @avatar-os/sensor 的真实类型对齐，不手写平行字符串）。 */
export type RelationshipFocusState = "FOCUSED" | "IDLE" | "AWAY";

/**
 * 返回边沿判定（纯函数，可单测）：仅 AWAY → 非 AWAY 算一次"用户回来"。
 *   - 首次读取（prev=null）不算；
 *   - 持续处于非 AWAY 不重复累计；
 *   - 再次进入 AWAY 后回来才再算一次。
 */
export function isReturnEdge(prev: RelationshipFocusState | null, cur: RelationshipFocusState): boolean {
  return prev === "AWAY" && cur !== "AWAY";
}

// —— 调参常量（集中，便于 BOSS 调手感）——
const DEDUP_WINDOW_MS = 1000; // 同一类型 1s 内的重复事件视为同一 / 广播回声，丢弃
const FAMILIARITY_PER_TOUCH = 0.02; // 单次触摸熟悉度增量（极小）
const FAMILIARITY_PER_SPEAK = 0.015;
const FAMILIARITY_PER_RETURN = 0.01;
const TRUST_PER_TOUCH = 0.008; // 单次触摸信任增量（极小，不因一次点击明显上升）
const TRUST_PER_SPEAK = 0.005;
const TRUST_PER_RETURN = 0.004;
const ACTIVE_DAY_BONUS = 0.03; // 每跨过一个活跃日，额外熟悉度奖励（activeDays 权重 > 疯狂点击）
const DAILY_DECAY = 0.85; // 同日同类型第 N 次互动增量衰减
const MAX_DECAY_STEPS = 8; // 衰减下限步数（避免增量为 0）
const ATTACHMENT_REQUIRED_DAYS = 7; // 依恋需要多日 / 多会话才形成
const ATTACHMENT_FROM_BASE = 0.8; // 依恋对 (familiarity+trust) 的缩放上限
const NATURAL_DECAY_PER_DAY = 0.002; // 长期未互动（>1 天）的极慢自然回落
const DAY_MS = 86_400_000;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export interface RelationshipRecordResult {
  state: RelationshipState;
  changed: boolean;
}

export class RelationshipEngine {
  private state: RelationshipState;
  private history: RelationshipHistory;
  private daily = { touch: 0, speak: 0, return: 0 };
  private lastKind: RelationshipInteractionKind | null = null;
  private lastInteractionAt = 0;

  constructor(initial?: Partial<RelationshipState>, initialHistory?: Partial<RelationshipHistory>) {
    this.state = clampRelationship({ ...NEUTRAL_RELATIONSHIP, ...(initial ?? {}) });
    this.history = { ...NEUTRAL_HISTORY, ...(initialHistory ?? {}) };
    this.lastInteractionAt = this.state.lastInteractionAt ?? 0;
  }

  getState(): RelationshipState {
    return { ...this.state };
  }
  getHistory(): RelationshipHistory {
    return { ...this.history };
  }

  /** 记录一次有效互动（touch/speak/return）。now 为事件时间戳(ms)。 */
  recordInteraction(kind: RelationshipInteractionKind, now: number): RelationshipRecordResult {
    // 去重：同一类型在 DEDUP_WINDOW_MS 内重复 → 视为同一事件 / 广播回声，丢弃
    if (this.lastKind === kind && now - this.lastInteractionAt < DEDUP_WINDOW_MS) {
      return { state: this.getState(), changed: false };
    }
    this.advanceDayIfNeeded(now);

    const step = Math.min(this.daily[kind], MAX_DECAY_STEPS);
    const factor = Math.pow(DAILY_DECAY, step); // 1, 0.85, 0.7225, ...

    switch (kind) {
      case "touch":
        this.state.familiarity = clamp01(this.state.familiarity + FAMILIARITY_PER_TOUCH * factor);
        this.state.relationalTrust = clamp01(this.state.relationalTrust + TRUST_PER_TOUCH * factor);
        this.history.touchCount += 1;
        break;
      case "speak":
        this.state.familiarity = clamp01(this.state.familiarity + FAMILIARITY_PER_SPEAK * factor);
        this.state.relationalTrust = clamp01(this.state.relationalTrust + TRUST_PER_SPEAK * factor);
        this.history.conversationCount += 1;
        break;
      case "return":
        this.state.familiarity = clamp01(this.state.familiarity + FAMILIARITY_PER_RETURN * factor);
        this.state.relationalTrust = clamp01(this.state.relationalTrust + TRUST_PER_RETURN * factor);
        this.history.returnCount += 1;
        break;
    }

    this.daily[kind] += 1;
    this.state.interactionCount += 1;
    this.history.meaningfulInteractionCount += 1;
    this.state.lastInteractionAt = now;
    this.state.firstMetAt = this.state.firstMetAt || now;
    this.state.lastUpdatedAt = now;
    this.lastKind = kind;
    this.lastInteractionAt = now;
    this.recomputeAttachment();
    return { state: this.getState(), changed: true };
  }

  /** 记录一次会话启动（同进程只调一次）。 */
  recordSession(now: number): RelationshipRecordResult {
    this.history.sessionCount += 1;
    this.state.firstMetAt = this.state.firstMetAt || now;
    this.state.lastUpdatedAt = now;
    return { state: this.getState(), changed: true };
  }

  /** 时间流逝的自然回落：仅当超过 1 天无互动时，信任 / 熟悉度极慢下降。短离不降。 */
  tickTime(now: number): RelationshipRecordResult {
    if (this.state.lastInteractionAt == null) return { state: this.getState(), changed: false };
    const elapsedDays = (now - this.state.lastInteractionAt) / DAY_MS;
    if (elapsedDays <= 1) return { state: this.getState(), changed: false };
    const decay = NATURAL_DECAY_PER_DAY * Math.floor(elapsedDays);
    this.state.relationalTrust = clamp01(this.state.relationalTrust - decay);
    this.state.familiarity = clamp01(this.state.familiarity - decay);
    this.state.lastUpdatedAt = now;
    this.recomputeAttachment();
    return { state: this.getState(), changed: true };
  }

  /** 重置为中性（仅开发态 RESET RELATIONSHIP 调用，需二次确认）。 */
  reset(): RelationshipRecordResult {
    this.state = { ...NEUTRAL_RELATIONSHIP };
    this.history = { ...NEUTRAL_HISTORY };
    this.daily = { touch: 0, speak: 0, return: 0 };
    this.lastKind = null;
    this.lastInteractionAt = 0;
    return { state: this.getState(), changed: true };
  }

  private advanceDayIfNeeded(now: number): void {
    const key = dayKey(now);
    if (key !== this.history.lastActiveDay) {
      this.history.lastActiveDay = key;
      this.state.activeDays += 1;
      this.daily = { touch: 0, speak: 0, return: 0 };
      // 跨日奖励：活跃天数比单日疯狂点击权重更高
      this.state.familiarity = clamp01(this.state.familiarity + ACTIVE_DAY_BONUS);
    }
  }

  private recomputeAttachment(): void {
    const dayFactor = Math.min(this.state.activeDays / ATTACHMENT_REQUIRED_DAYS, 1);
    const base = this.state.familiarity * 0.5 + this.state.relationalTrust * 0.5;
    this.state.attachment = clamp01(base * dayFactor * ATTACHMENT_FROM_BASE);
  }
}
