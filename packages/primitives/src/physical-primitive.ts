// ============================================================
// PhysicalPrimitive — 原子表现基元 (内核↔身体 的最终契约)
// ============================================================
// 大脑(BehaviorVM)只认「意图(Intent)」，身体(Embodiment)只认「基元(Primitive)」。
// 不管底层是骨骼、Live2D、LED 还是全息屏，统统被 EmbodimentRuntime 翻译为这些
// 原子指令。新增身体类型 = 在 EmbodimentRuntime 里加候选工厂，本契约一行不改。
//
// 关键纪律：
// - selection(选哪个 primitive) 由 EmbodimentRuntime 的候选链确定性决定；
// - weight(执行多重) 只用于程序化调制(低能量衰减、情绪强度)，绝不参与"选哪个"。

export enum PhysicalPrimitive {
  /** 头部倾斜（骨骼驱动） */
  HEAD_TILT = "HEAD_TILT",
  /** 身体倾斜（脊椎驱动） */
  BODY_LEAN = "BODY_LEAN",
  /** 视线追踪（程序化 look-at） */
  LOOK_AT = "LOOK_AT",
  /** 播放预制动画片段 */
  PLAY_ANIMATION = "PLAY_ANIMATION",
  /** 材质自发光（无脸模型的灯光表情） */
  MATERIAL_GLOW = "MATERIAL_GLOW",
  /** 材质颜色变化 */
  COLOR_SHIFT = "COLOR_SHIFT",
  /** 面部 BlendShape 设置 */
  BLENDSHAPE_SET = "BLENDSHAPE_SET",
  /** 气泡 / 文字输出（UI 层表现） */
  SPEECH_BUBBLE = "SPEECH_BUBBLE",
}

export interface PrimitiveCommand {
  type: PhysicalPrimitive;
  /** 载荷：例如 { clip: "Wave" } / { shape: "Smile", value: 0.8 } / { text: "你回来啦！" } */
  payload: Record<string, unknown>;
  /**
   * 执行权重(0~1)：仅用于程序化叠加调制（低能量衰减、情绪强度），
   * 不影响"选哪个 primitive"。
   */
  weight: number;
}
