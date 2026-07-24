import type { ChannelProperty, ChannelWrite } from "./animation-channel-scanner";

/**
 * v0.3.4-B+ Phase 2.1 —— Body Channel Authority（动画/程序层 身体写权限模型）。
 *
 * 这是「身体控制权模型」的最小数据层：只负责三件事 ——
 *   1. 保存当前占用（谁占着哪个通道）
 *   2. 查询权限（某写入者此刻能否写某通道）
 *   3. 更新事实（clip 起播/结束 时刷新占用）
 *
 * 不控制动画、不控制表情、不控制 gaze、不调 Three.js。它只是一块「当前谁占着」
 * 的只读事实板，由各层在写入前查询。
 *
 * 修正 1（BOSS）：内部用 `Map<channelKey, ChannelOwner>` 而非「只有 animation 的
 * 通道集合」。Phase 2 仅 animation 会写入，但数据结构支持任意 owner，未来
 * IK / VRM facial / mouse interaction 接入时无需重构数据模型。
 *
 * 修正 2（BOSS）：AnimationManager 不认识本模块 —— 它只发 clip 生命周期事件，
 * 由 Runtime 装配层监听后调用本模块的 setOwner/clearOwner。依赖方向是
 * AnimationManager → (event) → Runtime → Authority，而非 AnimationManager → Authority。
 * 因此本文件对 AnimationManager / Three.js / 渲染层 零依赖。
 */

/** 通道身份：骨 + 自由度类别。与 Phase 1 scanner 的 ChannelWrite 同形，复用其词汇避免漂移。 */
export type BodyChannel = ChannelWrite;

/** 重新导出，供 Phase 2.2/2.3 从本模块统一取身体通道词汇 */
export type { ChannelProperty } from "./animation-channel-scanner";

/** 通道规范化 key，供 Map/Set 使用 */
export const channelKey = (c: BodyChannel): string => `${c.bone}.${c.property}`;

/**
 * 写入者身份。
 * - animation：事实源（clip 播什么就写什么），永远 ALLOW。
 * - expression / gaze / headTilt / breathing：程序/表情层，通道被占时让出。
 * 未来扩展（IK / VRM facial / 交互）只需往这个 union 加成员，不改变数据结构。
 */
export type ChannelOwner =
  | "animation"
  | "expression"
  | "gaze"
  | "headTilt"
  | "breathing";

/** 写入裁决。当前阶段只需二元：可写 / 让出。DENY 留待未来优先级表。 */
export type WriteDecision = "ALLOW" | "YIELD";

export class BodyChannelAuthority {
  /** 当前各通道的占用者；Phase 2 仅 animation 会写入，但结构支持任意 owner */
  private occupancy: Map<string, ChannelOwner> = new Map();

  /** 声明一组通道的占用者（如 clip 起播时由 animation 占用） */
  setOwner(channels: BodyChannel[], owner: ChannelOwner): void {
    for (const c of channels) this.occupancy.set(channelKey(c), owner);
  }

  /** 释放一组通道的占用（如 clip 结束 / 淡出时） */
  clearOwner(channels: BodyChannel[]): void {
    for (const c of channels) this.occupancy.delete(channelKey(c));
  }

  /** 该通道当前是否被任何 owner 占用 */
  isOccupied(channel: BodyChannel): boolean {
    return this.occupancy.has(channelKey(channel));
  }

  /**
   * 查询某 owner 此刻能否写入某通道（纯函数语义，无隐藏状态变更）。
   * 规则（修正 2 简化版）：animation 永远可写；其余层在通道被占用时让出。
   * 未来扩展时再引入优先级表，不现在提前设计复杂规则。
   */
  canWrite(channel: BodyChannel, owner: ChannelOwner): WriteDecision {
    if (owner === "animation") return "ALLOW";
    return this.isOccupied(channel) ? "YIELD" : "ALLOW";
  }
}
