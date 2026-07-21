import { Color } from "three";
import { Mood } from "@avatar-os/primitives";

/**
 * 把 AvatarFSM 的情绪枚举映射到 3D 核心能量色。
 * 注意：真实枚举是 SLEEPY（不是计划里的 DROWSY），映射成暗冷色。
 */
export function moodColor(m: Mood): Color {
  switch (m) {
    case Mood.HAPPY:
      return new Color("#ff00ea"); // 霓虹粉
    case Mood.EXCITED:
      return new Color("#ff2200"); // 暴走红（最猛）
    case Mood.PLAYFUL:
      return new Color("#ff66cc"); // 调皮粉
    case Mood.SAD:
      return new Color("#1e6bff"); // 忧郁蓝
    case Mood.SLEEPING:
    case Mood.TIRED:
      return new Color("#223344"); // 熄灯暗冷
    case Mood.LONELY:
      return new Color("#6b5bff"); // 孤独紫
    case Mood.FOCUSED:
      return new Color("#ffcc00"); // 专注金
    case Mood.CURIOUS:
    case Mood.CALM:
    default:
      return new Color("#00ffcc"); // 默认赛博青
  }
}
