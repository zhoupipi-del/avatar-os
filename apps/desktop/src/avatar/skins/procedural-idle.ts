// ============================================================
// ProceduralIdle — 待机呼吸/微动 (v0.3.3)
// ============================================================
// 纯计算模块，不碰渲染、不碰内核事件总线，只吃时间戳吐偏移量。
//
// 设计边界（基于已核实的代码事实）：
// - BagCharacterExpression.update() 每帧对 spine.rotation 做 copy() 硬覆盖，
//   所以呼吸绝不能用 spine.rotation，只能用 spine.position。
// - head.rotation.x/y 已被 gaze 视线跟随占用（StandardAvatarSkin.tsx:103-109），
//   这版不碰 head，只做 spine 呼吸——范围收紧，先验证这一层顺不顺眼。
// - idleClip:"" 时 mixer 无 active action、不写骨骼（resolve() 代码原文已验证），
//   纯待机态下 spine.position 不会被 mixer 覆盖。
//
// 未验证的假设（先标注，不假装已验证）：
// 不知道 GREET/BOUNCE_HAPPY 的 NLA clip 是否也会动画 Spine01 的 position
// （只确认了会动 rotation，因为动作本身就是关节转动）。若这些 clip 也动
// position，呼吸偏移会在 clip 播放期间叠加在动画上，效果未知——建议先跑
// 起来肉眼看一次 GREET 播放时有没有违和感，不顺眼再加"播放时暂停呼吸"。

export interface ProceduralIdleParams {
  /** 呼吸幅度（世界单位，建议 << 1，模型整体 fitHeight≈2.6 参考量级） */
  amplitude?: number;
  /** 呼吸频率（Hz，每秒完整呼吸次数） */
  frequency?: number;
  /** 相位偏移（弧度），用于错开多个部位，避免完全同步显机械感 */
  phase?: number;
}

const DEFAULTS: Required<ProceduralIdleParams> = {
  amplitude: 0.012,
  frequency: 0.28, // 约 3.6 秒一个完整呼吸周期，偏缓慢放松
  phase: 0,
};

/**
 * 给定累计时间，算出当前呼吸偏移量（单一正弦，最小实现）。
 * 纯函数、不持有 mutable 状态，方便日后多部位复用不同 phase/frequency。
 */
export function breathingOffset(elapsed: number, params?: ProceduralIdleParams): number {
  const { amplitude, frequency, phase } = { ...DEFAULTS, ...params };
  return Math.sin(elapsed * frequency * Math.PI * 2 + phase) * amplitude;
}
