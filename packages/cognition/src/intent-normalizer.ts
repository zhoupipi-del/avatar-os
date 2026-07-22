// ============================================================
// intent-normalizer — 意图归一化 (v0.3-M1 最小版, 观察优先)
// ============================================================
// 设计原则（来自 Step 0 刹车原则）：
//   1. 不改变主链路：本模块是纯函数，仅把 LLM 原始意图字符串映射为合法
//      PhysicalIntentType，或标记为 NONE / UNKNOWN。引擎在派发前调用它，
//      链路拓扑完全不变。
//   2. 不引入失败点：本函数永远不抛异常；任何奇葩输入都落到 UNKNOWN
//      （保留 raw），绝不因为"认不出"而让整条大脑崩溃。
//   3. 出问题时易定位：结果携带 raw 原文，DebugConsole 的 Agent Trace 直接
//      打印 raw → normalized；未来训练 Intent Router 也有原始证据可挖。
//
// 三层结构：
//   L1 格式清洗：trim + 大写 + 折叠空白 + 去首尾引号
//   L2 显式别名：少量人工确认的同义映射（hello/hi/你好/问候… → GREET）
//   L3 未知保留：命中不了就 UNKNOWN（绝不静默丢弃 raw）。
//
// NONE vs UNKNOWN（语义不同，必须分得清）：
//   NONE     = 模型【明确判断】没有肢体动作意图（如省略字段 / "无" / "none"）
//   UNKNOWN  = 系统【不知道怎么办】（如 "陪伴一下" / "social_contact"），进日志待训练
// ============================================================

import { PhysicalIntentType } from "@avatar-os/primitives";

/** 归一化后的意图：合法物理意图 + 两个非物理语义态 */
export type NormalizedIntent = PhysicalIntentType | "NONE" | "UNKNOWN";

export interface NormalizationResult {
  /** LLM 给的原始意图字符串（未加工），永远保留 */
  raw: string;
  /** 归一化结果 */
  normalized: NormalizedIntent;
  /** 是否明确识别为合法意图或 NONE（false = UNKNOWN，需进日志排查） */
  matched: boolean;
}

// L2：显式别名表（小而精，不堆大表。真实 Ollama 输出分布未知，先覆盖最常见同义）
const ALIASES: Record<string, NormalizedIntent> = {
  // —— 无动作（模型明确判断没有肢体意图）——
  NONE: "NONE",
  NO_ACTION: "NONE",
  NO: "NONE",
  "无": "NONE",
  "无事": "NONE",
  "没有": "NONE",
  "无动作": "NONE",
  // —— GREET ——
  GREET: "GREET",
  GREETING: "GREET",
  HELLO: "GREET",
  HI: "GREET",
  HEY: "GREET",
  "你好": "GREET",
  "您好": "GREET",
  "问候": "GREET",
  "打招呼": "GREET",
  // —— PEEK ——
  PEEK: "PEEK",
  PEEKING: "PEEK",
  "探头": "PEEK",
  "偷看": "PEEK",
  // —— STRETCH ——
  STRETCH: "STRETCH",
  STRETCHING: "STRETCH",
  "伸懒腰": "STRETCH",
  // —— DOZE ——
  DOZE: "DOZE",
  SLEEP: "DOZE",
  SLEEPING: "DOZE",
  "睡觉": "DOZE",
  "打盹": "DOZE",
  // —— LOOK_AT_USER ——
  LOOK_AT_USER: "LOOK_AT_USER",
  LOOK: "LOOK_AT_USER",
  GAZE: "LOOK_AT_USER",
  "看用户": "LOOK_AT_USER",
  "看过来": "LOOK_AT_USER",
  // —— BOUNCE_HAPPY ——
  BOUNCE_HAPPY: "BOUNCE_HAPPY",
  BOUNCE: "BOUNCE_HAPPY",
  HAPPY: "BOUNCE_HAPPY",
  "跳跃": "BOUNCE_HAPPY",
  "开心跳": "BOUNCE_HAPPY",
  // —— IDLE_BREATHE ——
  IDLE_BREATHE: "IDLE_BREATHE",
  IDLE: "IDLE_BREATHE",
  BREATHE: "IDLE_BREATHE",
  "待机": "IDLE_BREATHE",
};

// L1：格式清洗。把 " greet \n" / "GREETING" / "\"hi\"" 归一成可查表键。
function clean(raw: string): string {
  return raw
    .trim()
    .replace(/^["'「『]|["'」』]$/g, "") // 去首尾引号（LLM 偶尔包引号）
    .toUpperCase()
    .replace(/\s+/g, "_"); // 空白折叠为下划线
}

/**
 * 归一化 LLM 原始意图。永远不抛异常。
 * @returns { raw, normalized, matched }。raw 恒等于输入原文（或空串），供观测/训练。
 */
export function normalizeIntent(raw: string | undefined | null): NormalizationResult {
  const r = (raw ?? "").toString();
  const cleaned = clean(r);
  if (cleaned === "") {
    // 空意图：视为"模型没给动作意图"，等价于 NONE（明确无动作），不进 UNKNOWN 噪音
    return { raw: r, normalized: "NONE", matched: true };
  }
  const mapped = ALIASES[cleaned];
  if (mapped) {
    return { raw: r, normalized: mapped, matched: true };
  }
  // L3：未知保留。绝不丢弃 raw —— 它是未来 Intent Router 的训练语料
  return { raw: r, normalized: "UNKNOWN", matched: false };
}

/** 是否为可派发到身体的合法物理意图（NONE/UNKNOWN 不驱动身体） */
export function isDispatchable(n: NormalizedIntent): n is PhysicalIntentType {
  return n !== "NONE" && n !== "UNKNOWN";
}
