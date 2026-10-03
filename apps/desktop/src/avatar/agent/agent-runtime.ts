import type {
  AgentBodyBridge,
  AgentBrain,
  AgentBrainOutput,
} from "./agent-intent";

export interface AgentRuntimeSnapshot {
  readonly isThinking: boolean;
  readonly lastUserText: string | null;
  readonly lastOutput: AgentBrainOutput | null;
  readonly error: string | null;
}

export class AgentRuntime {
  private isThinking = false;
  private lastUserText: string | null = null;
  private lastOutput: AgentBrainOutput | null = null;
  private error: string | null = null;
  private sequence = 0;
  private pending: AbortController | null = null;

  constructor(
    private readonly brain: AgentBrain,
    private readonly body: AgentBodyBridge,
  ) {}

  async receiveText(text: string): Promise<AgentBrainOutput | null> {
    if (!text.trim()) return null;
    const currentSequence = ++this.sequence;
    this.pending?.abort();
    this.body.stop?.();
    const pending = new AbortController();
    this.pending = pending;

    this.isThinking = true;
    this.lastUserText = text;
    this.error = null;
    this.body.setThinking?.(true);

    try {
      const output = await this.brain.think({
        text,
        now: Date.now(),
        signal: pending.signal,
      });

      if (currentSequence !== this.sequence) {
        return null;
      }

      this.lastOutput = output;
      this.body.setThinking?.(false);

      this.perform(output);

      return output;
    } catch (error) {
      if (currentSequence !== this.sequence) {
        return null;
      }

      this.error =
        error instanceof Error ? error.message : String(error);

      const fallback: AgentBrainOutput = {
        speech: "我刚才有点卡住了，但我还在。",
        intent: {
          type: "THINKING",
          intensity: 0.3,
        },
        emotion: {
          type: "neutral",
          intensity: 0.2,
        },
      };

      this.lastOutput = fallback;
      this.body.setThinking?.(false);

      this.perform(fallback);

      return fallback;
    } finally {
      if (currentSequence === this.sequence) {
        this.isThinking = false;
        this.pending = null;
      }
    }
  }

  interrupt(): void {
    this.sequence += 1;
    this.pending?.abort();
    this.pending = null;
    this.isThinking = false;
    this.body.setThinking?.(false);
    this.body.stop?.();
  }

  private perform(output: AgentBrainOutput): void {
    if (this.body.perform) {
      this.body.perform(output);
      return;
    }
    this.body.setEmotion(output.emotion);
    if (!(output.motion && this.body.playMotion?.(output.motion))) {
      this.body.playIntent(output.intent);
    }
    this.body.speakText(output.speech);
  }

  snapshot(): AgentRuntimeSnapshot {
    return {
      isThinking: this.isThinking,
      lastUserText: this.lastUserText,
      lastOutput: this.lastOutput,
      error: this.error,
    };
  }
}
