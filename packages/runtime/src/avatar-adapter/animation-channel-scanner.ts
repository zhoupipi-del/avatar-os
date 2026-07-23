import * as THREE from "three";

/**
 * v0.3.4-B+ Phase 1 —— Animation Capability Discovery（方案 a）。
 *
 * 运行时扫描 THREE.AnimationClip.tracks，自动推导「一个动画到底会碰哪些身体自由度」，
 * 而非在 RigConfig 里人工声明每个 clip 占用哪些骨/通道（方案 b 会把资产知识重新
 * 维护回配置层，不可扩展：VRM / Robot / Motion Capture 每个新模型都要人工重标
 * "这个动作占哪些骨、哪些通道"，最终退化成 AvatarOS + 大量人工资产规则）。
 *
 * 这是纯函数、零副作用、profile 无关：只读取 clip 的 track 元数据，不改任何播放/
 * 写入行为。仲裁（多个系统同时想控制身体时谁有优先权）是 Phase 2 的事，本模块只
 * 负责「让系统第一次知道」一个动画碰哪些自由度。
 */

export type ChannelProperty =
  | "rotation"
  | "position"
  | "scale"
  | "morphTargetInfluences";

export interface ChannelWrite {
  /** 骨骼节点名（track.name 中最后一个 "." 之前的部分，如 "Head" / "Spine01"） */
  bone: string;
  /** 语义通道：quaternion/rotation→rotation，position→position，scale→scale，morphTargetInfluences→表情 */
  property: ChannelProperty;
}

export type AnimationOwnershipMap = Record<string, ChannelWrite[]>;

/** 把 THREE track 名后缀映射为语义通道；无法识别的后缀返回 null（被忽略） */
function propertyFromTrackName(trackName: string): ChannelProperty | null {
  const dot = trackName.lastIndexOf(".");
  if (dot === -1) return null;
  const suffix = trackName.slice(dot + 1).toLowerCase();
  switch (suffix) {
    case "quaternion":
    case "rotation":
      return "rotation";
    case "position":
      return "position";
    case "scale":
      return "scale";
    case "morphtargetinfluences":
      return "morphTargetInfluences";
    default:
      return null;
  }
}

function channelWriteOf(track: THREE.KeyframeTrack): ChannelWrite | null {
  const dot = track.name.lastIndexOf(".");
  if (dot === -1) return null;
  const bone = track.name.slice(0, dot);
  const property = propertyFromTrackName(track.name);
  if (!property) return null;
  return { bone, property };
}

/** 扫描单个 clip 的 tracks，返回它写入的「骨骼.通道」列表（同 clip 内去重） */
export function scanClipChannels(clip: THREE.AnimationClip): ChannelWrite[] {
  const writes: ChannelWrite[] = [];
  if (!clip || !clip.tracks) return writes;
  const seen = new Set<string>();
  for (const track of clip.tracks) {
    const w = channelWriteOf(track);
    if (!w) continue;
    const key = `${w.bone}.${w.property}`;
    if (seen.has(key)) continue;
    seen.add(key);
    writes.push(w);
  }
  return writes;
}

/** 扫描一组 clip，返回 { clipName: ChannelWrite[] } 的所有权映射 */
export function buildAnimationOwnershipMap(
  clips: THREE.AnimationClip[],
): AnimationOwnershipMap {
  const map: AnimationOwnershipMap = {};
  for (const clip of clips) {
    if (clip && clip.name) map[clip.name] = scanClipChannels(clip);
  }
  return map;
}
