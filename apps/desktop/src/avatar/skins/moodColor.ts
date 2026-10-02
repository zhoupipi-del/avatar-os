import { Color } from "three";
import { Mood } from "@avatar-os/primitives";

/**
 * 情绪 → 自发光(emissive)颜色（字符串版，适配材质 emissive 字符串赋值，
 * 与 2D 端语义一致：开心暖金 / 低落冷蓝 / 困倦暗紫 …）。
 */
export function moodEmissive(m: Mood): string {
  switch (m) {
    case Mood.HAPPY:
    case Mood.EXCITED:
    case Mood.PLAYFUL:
      return "#ffcf4a"; // 暖金 · 开心
    case Mood.SAD:
    case Mood.LONELY:
      return "#4a7bff"; // 冷蓝 · 低落
    case Mood.TIRED:
    case Mood.SLEEPING:
      return "#5a5a7a"; // 暗紫 · 困倦
    case Mood.FOCUSED:
      return "#4affd5"; // 青绿 · 专注
    case Mood.CALM:
    default:
      return "#7affc0"; // 薄荷 · 平静
  }
}

/**
 * 把 AvatarFSM 的情绪枚举映射到 3D 核心能量色（three.Color 版，适配 R3F 材质）。
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
