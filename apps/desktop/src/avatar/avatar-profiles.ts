// ============================================================
// avatar-profiles — AvatarOS 身体目录 + 所有权装配 (v0.3.4-A)
// ============================================================
// 本文件持有"具体资产与 RigConfig"（desktop 侧知识），不持有 active 状态
// （那是 @avatar-os/runtime 的 AvatarService 的事）。
//
// 职责边界（与 BOSS 拍板一致）：
//   - avatarService        → 持有"当前激活的是谁"这一事实（runtime，可订阅）
//   - AVATAR_PROFILES    → 持有 id → RigConfig 映射（desktop，资产知识）
//   - resolveAvatarProfile → 解析 + 非法 id 回退默认（bag）
//   - attachAvatarPersistence → Composition Root 装配缝（Phase C 接真实存储）
//
// UI / React 只：订阅 avatarService 拿 activeId → resolveAvatarProfile 拿 config → 渲染。
// UI 永不直接 load GLB、永不直接写 activeId（只能 activate()）。

import type { RigConfig } from "./skins/RiggedGLBSkin";
import { BAG_CONFIG } from "./skins/RiggedGLBSkin";
import { AvatarService, type AvatarId } from "@avatar-os/runtime";

export interface AvatarProfile {
  id: AvatarId;
  config: RigConfig;
}

/**
 * Fantasy Warrior（Showcase Body）— v0.3.4-B 经同一条 activate() 路径注册，不写特判。
 * 4 个 clip 真实语义（2026-07-25 BOSS 真机肉眼标定，以真机观感为准而非时长/数值推断）：
 *   NlaTrack     (18.29s) → STRETCH     （压腿/拉伸准备）
 *   NlaTrack.001 ( 2.58s) → 防御姿势    （暂不绑定，保留待 v0.3.5+ 新意图词）
 *   NlaTrack.002 ( 5.58s) → GREET       （挥手 ✅）
 *   NlaTrack.003 ( 1.29s) → 奔跑        （暂不绑定：奔跑非情绪动作，不接 BOUNCE_HAPPY）
 * idleClip="" + 程序化呼吸/headTilt/gaze（与 bag 同策略，Phase 2.3 Authority 保护）。
 * fitHeight=2.6 与 bag 同高，相机固定 [0,0.3,5] fov35 也能框住。
 */
const WARRIOR_CONFIG: RigConfig = {
  url: "/models/fantasy-warrior.glb",
  headBone: /^head$/i, // 大小写不敏感精确匹配 "Head"（warrior 骨骼首字母大写）
  idleClip: "", // warrior 无静态 idle clip（4 个 clip 全带腿部动作，无循环待机，暂置空；真待机待 v0.3.5+ 资产生产流程）
  intentClip: {
    STRETCH: "NlaTrack",     // 18.29s 压腿/拉伸
    GREET: "NlaTrack.002",   // 5.58s 挥手 ✅（原误标 .001 防御姿势，真机肉眼校正）
    // BOUNCE_HAPPY 不接：NlaTrack.003=奔跑(非情绪动作)语义不匹配；.001=防御姿势也无快乐语义，全部暂挂
  },
  statusClip: {}, // 系统状态暂不映射到 warrior clip（未标定，保持身体能力最简）
  spineBone: "Spine01",
  fitHeight: 2.6, // 与 bag 同高，相机固定 [0,0.3,5] fov35 也能框住
};

/**
 * 稳定目录：id → RigConfig。
 * v0.3.4-B 起含两个身体（bag-character / fantasy-warrior），均经 AvatarService.activate() 平等切换，
 * 不在任何渲染/大脑代码里写 `if(model==="fantasy-warrior")` 特判。
 */
export const AVATAR_PROFILES: Record<AvatarId, AvatarProfile> = {
  "bag-character": { id: "bag-character", config: BAG_CONFIG },
  "fantasy-warrior": { id: "fantasy-warrior", config: WARRIOR_CONFIG },
};

export const DEFAULT_AVATAR_ID: AvatarId = "bag-character";

/**
 * 解析 profile；非法 / 未知 id 回退默认（bag），
 * 避免激活一个不存在的身体导致渲染崩溃。
 */
export function resolveAvatarProfile(id: AvatarId): AvatarProfile {
  return AVATAR_PROFILES[id] ?? AVATAR_PROFILES[DEFAULT_AVATAR_ID];
}

/**
 * 身体所有权单例：在模块加载时实例化。
 * 状态 / 变更权限封装在 AvatarService 内部——本处只 new，不持有也不改状态。
 * App.tsx 负责用 attachAvatarPersistence 把它和存储缝接（Composition Root 装配）。
 */
export const avatarService = new AvatarService(DEFAULT_AVATAR_ID);

/**
 * 持久化缝（Phase C 接真实存储：localStorage / Tauri store / 用户偏好）。
 * Phase A 仅类型 + 内存占位，证明"存储可注入、不内嵌于服务"。
 */
export interface AvatarStorageAdapter {
  load(): AvatarId | undefined;
  save(id: AvatarId): void;
}

/** 默认内存占位：无持久化来源 → restore 空操作，恒为默认 bag。 */
export const IN_MEMORY_AVATAR_STORAGE: AvatarStorageAdapter = {
  load: () => undefined,
  save: () => {},
};

/**
 * Composition Root 装配：从存储恢复 activeId + 订阅变更回写。
 * 由 App.tsx 在自举期调用一次。返回取消订阅函数（App 卸载时清理）。
 */
export function attachAvatarPersistence(
  service: AvatarService = avatarService,
  adapter: AvatarStorageAdapter = IN_MEMORY_AVATAR_STORAGE,
): () => void {
  service.restore(adapter.load());
  return service.subscribe((s) => adapter.save(s.activeId));
}
