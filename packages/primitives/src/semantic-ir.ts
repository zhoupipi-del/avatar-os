import { Mood } from "./mood";
import { PhysicalIntentType } from "./intent";

/**
 * SemanticIR — 语义中间表示（内核↔认知层协议）。
 *
 * 红线4 收敛：action.type 不再使用 BOUNCE/SHAKE/BLINK/STRETCH/SLEEP 等
 * 精灵级名词，统一对齐 PhysicalIntentType 词表，保证从「语义规划」到
 * 「物理意图派发」的符号一致性，杜绝两套命名漂移。
 */
export interface SemanticIR {
  version: "v1";
  text?: string;
  emotion: {
    targetMood: Mood;
    intensity: number;
  };
  action: {
    type: PhysicalIntentType;
    speed: number;
  };
  durationMs: number;
}
