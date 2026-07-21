/**
 * 模型能力自省结果 —— 加载器在底层「体检」后产出，
 * 供 Behavior VM / ExpressionController 决定「能不能接骨骼、能不能播动画、有没有脸」。
 *
 * 这是「面向能力编程」的核心数据：未来换任意用户 Mod 模型，
 * 系统先看 capabilities，再决定降级策略（无脸→姿态演情绪，无骨骼→静态+灯光）。
 */
export interface AvatarCapabilities {
  /** 是否含骨架（能否驱动骨骼动画） */
  hasSkeleton: boolean;
  /** 是否含面部 BlendShape（能否直出表情） */
  hasBlendShapes: boolean;
  /** 模型自带的全部动画片段名（真实名，可能无语义如 NlaTrack.001） */
  availableAnimations: string[];
  /** 探测到的全部骨骼名（供运行时按正则/名定位头骨/脊椎骨） */
  skeletonBoneNames: string[];
}
