import { Mood, MoodState, PhysicalIntent, PhysicalIntentType } from "@avatar-os/primitives";
import { kernelEventBus } from "./event-bus";

export class AvatarFSM {
  private state: MoodState = { current: Mood.CALM, intensity: 1.0 };
  private resetTimer: number | null = null;

  constructor() {
    this.initListeners();
  }

  public getMood(): MoodState {
    return { ...this.state };
  }

  /**
   * 情绪状态恢复（Snapshot 回填用）。直接覆盖内部 state。
   */
  public restoreState(savedMood: MoodState): void {
    this.state = { ...savedMood };
    console.log(`[AvatarFSM 🔄] Mood restored to ${savedMood.current}`);
  }

  private initListeners() {
    // 近场触发（新内核 SENSOR_MOUSE_NEAR）
    kernelEventBus.on("SENSOR_MOUSE_NEAR", () => {
      if (this.state.current === Mood.CALM) {
        this.transitionTo(Mood.CURIOUS);
      }
    });

    kernelEventBus.on("SENSOR_MOUSE_FAR", () => {
      if (this.state.current === Mood.CURIOUS) {
        this.transitionTo(Mood.CALM);
      }
    });

    // 接收 BehaviorVM 输出的 PhysicalIntent，映射为 Mood（FSM 是 Mood 唯一权威）
    // 红线1 已焊死：UI/传感器不决定状态，内核 PhysicalIntent 经此处路由为 Mood。
    kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (intent: PhysicalIntent) => {
      const target = this.mapIntentToMood(intent.type);
      if (target) {
        this.transitionTo(target);
        this.scheduleReset(Mood.CALM, 8000);
      }
    });
  }

  /** PhysicalIntent → Mood 映射（仅映射"带情绪"的高阶意图） */
  private mapIntentToMood(type: PhysicalIntentType): Mood | null {
    switch (type) {
      case "DOZE":
        return Mood.SLEEPING;
      case "BOUNCE_HAPPY":
        return Mood.PLAYFUL;
      case "GREET":
        return Mood.HAPPY;
      case "PEEK":
        return Mood.CURIOUS;
      default:
        return null; // IDLE_BREATHE / LOOK_AT_USER / STRETCH 等纯动作不影响 Mood
    }
  }

  private transitionTo(mood: Mood) {
    this.state = { current: mood, intensity: 1.0 };
    kernelEventBus.emit("STATE_MOOD_CHANGED", { mood });
  }

  private scheduleReset(targetMood: Mood, delayMs: number) {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = window.setTimeout(() => {
      this.transitionTo(targetMood);
      kernelEventBus.emit("STATE_MOTION_CHANGED", { motion: "BREATH" });
    }, delayMs);
  }
}

export const avatarFSM = new AvatarFSM();
