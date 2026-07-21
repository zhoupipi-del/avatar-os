// ============================================================
// PhysicalIntent — 物理意图（内核唯一对外的"行为指令"契约）
// v0.1.0-alpha Kernel Skeleton：意图不再是裸标签，而是带【溯源元数据】
// 的可仲裁单元——谁发起(source)、多想做(priority)、多确信(confidence)、
// 何时发起(timestamp)。这是 Arbiter 抢占仲裁与 Telemetry 归因的物理基础。
// ============================================================

export type PhysicalIntentType =
  | "IDLE_BREATHE"    // 默认平静呼吸
  | "LOOK_AT_USER"    // 视线/躯体追踪用户
  | "DOZE"            // 打瞌睡/沉睡
  | "STRETCH"         // 伸懒腰
  | "GREET"           // 打招呼/问候
  | "PEEK"            // 试探性偷看
  | "BOUNCE_HAPPY";    // 愉悦跃动

/**
 * IntentSource — 意图溯源。区分"谁发起了这次行为"，
 * 用于 Arbiter 归因、Telemetry 统计、以及"用户因果 vs 内核自主"的边界判定。
 */
export type IntentSource =
  | "DRIVE"   // 驱动引擎（能量/社交/好奇等内在冲动）
  | "SENSOR"  // 传感器（鼠标近场、空闲探测等外部输入）
  | "MEMORY"  // 记忆内核（基于历史画像的关系性行为）
  | "AI"      // 认知层（LLM/语义规划，Day15+ 接入）
  | "SYSTEM";  // 系统级（自举复位、昼夜节律等）

export interface PhysicalIntent {
  type: PhysicalIntentType;
  intensity: number;   // 0.0 ~ 1.0 意图表达强度
  priority: number;    // 0 ~ 100 抢占权重（Arbiter 仲裁依据）
  source: IntentSource;// 意图溯源
  confidence: number;  // 0.0 ~ 1.0 内核对该意图的确信度
  timestamp: number;   // 发起时刻 (epoch ms)
  durationMs?: number; // 期望持续时间 (ms)
  payload?: Record<string, unknown>;
}

/**
 * makeIntent — 意图工厂。补齐溯源元数据默认值，避免每个构造点重复样板。
 * 调用方只需提供 type/intensity 与关键覆盖项，priority/source/confidence/timestamp
 * 由此统一注入合理默认值（timestamp 一律取当前时刻）。
 */
export function makeIntent(
  partial: Pick<PhysicalIntent, "type" | "intensity"> & Partial<PhysicalIntent>,
): PhysicalIntent {
  return {
    priority: 10,
    source: "SYSTEM",
    confidence: 1.0,
    timestamp: Date.now(),
    ...partial,
  };
}
