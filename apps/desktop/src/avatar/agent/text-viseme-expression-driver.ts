import {
  LipSyncExpressionWriter,
  type LipSyncExpressionManagerLike,
  type LipSyncExpressionWriterStatus,
} from "./lip-sync-expression-writer";
import {
  TextVisemeTimeline,
  type TextVisemeFrame,
  type TextVisemeTimelineStatus,
} from "./text-viseme-timeline";

export interface TextVisemeExpressionDriverOptions {
  readonly enabled?: boolean;
  readonly now?: () => number;
}

export interface TextVisemeExpressionDriverStatus {
  readonly enabled: boolean;
  readonly frame: TextVisemeFrame;
  readonly timeline: TextVisemeTimelineStatus;
  readonly writer: LipSyncExpressionWriterStatus;
}

export class TextVisemeExpressionDriver {
  private enabled: boolean;
  private readonly timeline: TextVisemeTimeline;
  private readonly writer: LipSyncExpressionWriter;

  constructor(options: TextVisemeExpressionDriverOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.timeline = new TextVisemeTimeline({
      now: options.now,
    });
    this.writer = new LipSyncExpressionWriter({
      enabled: this.enabled,
    });
  }

  setEnabled(
    enabled: boolean,
    manager?: LipSyncExpressionManagerLike | null,
  ): void {
    this.enabled = enabled;
    this.writer.setEnabled(enabled, manager);

    if (!enabled) {
      this.timeline.cancel();
    }
  }

  setProbeAvailable(
    available: boolean,
    manager?: LipSyncExpressionManagerLike | null,
  ): void {
    this.writer.setProbeAvailable(available, manager);
  }

  startText(text: string): void {
    if (!this.enabled) {
      return;
    }

    this.timeline.startText(text);
  }

  update(
    manager: LipSyncExpressionManagerLike | null | undefined,
    delta = 0.016,
  ): TextVisemeFrame {
    const frame = this.enabled ? this.timeline.update() : restFrame();
    this.writer.applyFrame(manager, frame, delta);
    return frame;
  }

  cancel(manager?: LipSyncExpressionManagerLike | null): void {
    this.timeline.cancel();
    this.writer.resetAll(manager);
  }

  getStatus(): TextVisemeExpressionDriverStatus {
    return {
      enabled: this.enabled,
      frame: this.timeline.getStatus(),
      timeline: this.timeline.getStatus(),
      writer: this.writer.getStatus(),
    };
  }
}

function restFrame(): TextVisemeFrame {
  return {
    active: false,
    progress: 0,
    primary: null,
    secondary: null,
    primaryWeight: 0,
    secondaryWeight: 0,
    intensity: 0,
    phase: "rest",
  };
}
