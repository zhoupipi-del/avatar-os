// ============================================================
// 对接端口契约 (Integration Port Contract)
// ------------------------------------------------------------
// 这是桌面智能体(Avatar OS)对外暴露的【通用】对接端口。
// 任何外部系统（WINGS 德育平台、日历、IoT…）都可经本契约向
// 头像推送"外部事件"，而无需耦合头像内核(Mood / Intent / FSM)。
//
// 设计原则：
//   - 纯类型 + 自包含 pub/sub，零依赖内核与渲染层。
//   - 不引入任何"WINGS 专属"概念；WINGS 只是该端口的一个消费者。
//   - 头像内核(Mood/Intent)保持纯净，融合期的视觉映射另行接入。
// ============================================================

/** 外部事件等级——决定融合期头像如何反应（参考实现用） */
export type ExternalEventKind = "crisis" | "warning" | "info";

/** 外部事件源标识（用于去重/归因，如 "wings"） */
export type ExternalSourceId = string;

/** 通用的外部事件负载——与任何具体后端解耦 */
export interface ExternalEvent {
  source: ExternalSourceId; // 来源系统，如 "wings"
  kind: ExternalEventKind; // 等级
  title: string; // 短标题（气泡标题）
  detail?: string; // 详情（气泡正文）
  payload?: unknown; // 任意结构化上下文（供 LLM / UI 使用）
  timestamp?: number; // 事件发生时刻(epoch ms)
}

/** 外部源处理器：该源有事件到达时回调 */
export type ExternalEventSink = (event: ExternalEvent) => void;
