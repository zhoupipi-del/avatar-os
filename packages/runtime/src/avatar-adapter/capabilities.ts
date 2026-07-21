/**
 * 模型能力自省结果 —— 加载器在底层「体检」后产出，
 * 供 Behavior VM / ExpressionController 决定「能不能接骨骼、能不能播动画、有没有脸」。
 *
 * 这是「面向能力编程」的核心数据：未来换任意用户 Mod 模型，
 * 系统先看 capabilities，再决定降级策略（无脸→姿态演情绪，无骨骼→静态+灯光）。
 */
export interface AnimationMeta {
  name: string;
  /** 片段时长(秒)，用于挑"最长=大幅动作"等启发式 */
  duration: number;
}

/** 扫描器得出的综合能力标签 */
export type AvatarFeature =
  | "procedural_look_at" // 可通过骨骼程序化追踪视线
  | "procedural_breathing" // 有 idle 呼吸程序化
  | "prebaked_animation" // 自带预制动画片段
  | "facial_expression" // 有面部 BlendShape
  | "led_display"; // 靠材质自发光模拟情绪/显示

export interface AvatarCapabilities {
  /** 是否含骨架（能否驱动骨骼动画） */
  hasSkeleton: boolean;
  /** 是否含面部 BlendShape（能否直出表情） */
  hasBlendShapes: boolean;
  /** 模型自带的全部动画片段名（真实名，可能无语义如 NlaTrack.001） */
  availableAnimations: string[];
  /** 探测到的全部骨骼名（供运行时按正则/名定位头骨/脊椎骨） */
  skeletonBoneNames: string[];

  // ---- 以下为 Embodiment 层扩展字段 ----
  /** 模型支持被驱动的具体骨骼名（供候选工厂按名定位 Head/Spine 等） */
  supportedBones: string[];
  /** 片段元信息（含时长） */
  availableClips: AnimationMeta[];
  /** 综合能力标签（扫描器结论） */
  features: AvatarFeature[];
  /** 是否支持通过材质自发光模拟情绪（无脸模型的降级表情） */
  hasMaterialEmotion: boolean;
  /** 可用的 BlendShape 名（如 ["Smile","Blink"]） */
  availableBlendShapes: string[];
}
