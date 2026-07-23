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
 * 只挂已标定的 GREET（NlaTrack.002 = 摇头打招呼）；下腰/抬起双手/奔跑 三项不注册，
 * 等 v0.3.4 New Intent Vocabulary 给 warrior 定专属词（CELEBRATE/BOW/APPROACH…）再回填。
 * 不接 idle clip（4 个 clip 全动 Head/Spine 的 rotation+translation+scale，循环 idle 会压呼吸），
 * 故 idleClip="" + 程序化呼吸/headTilt（与 bag 同策略）。fitHeight=2.6 与 bag 同高，相机不调也能框住。
 */
const WARRIOR_CONFIG: RigConfig = {
  url: "/models/fantasy-warrior.glb",
  headBone: /^head$/i, // 大小写不敏感精确匹配 "Head"（warrior 骨骼首字母大写）
  idleClip: "", // 不接 idle clip，程序化呼吸 + headTilt
  intentClip: {
    GREET: "NlaTrack.002", // 摇头打招呼，v0.3.4-prep Step2 真机标定
    // 其余 clip（下腰/抬起双手/奔跑）不注册：等 New Intent Vocabulary 定 warrior 专属词再回填
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
