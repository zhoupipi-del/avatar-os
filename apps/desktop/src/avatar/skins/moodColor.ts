import { Mood } from "@avatar-os/primitives";

/**
 * 情绪 → 自发光(emissive)颜色。3D 皮肤用它对模型材质做情绪染色，
 * 与 2D 端的 moodColor 语义一致（开心暖金 / 低落冷蓝 / 困倦暗紫 …）。
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
