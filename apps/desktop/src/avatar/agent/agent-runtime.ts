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

  constructor(
    private readonly brain: AgentBrain,
    private readonly body: AgentBodyBridge,
  ) {}

  async receiveText(text: string): Promise<AgentBrainOutput | null> {
    const currentSequence = ++this.sequence;

    this.isThinking = true;
    this.lastUserText = text;
    this.error = null;

    try {
      const output = await this.brain.think({
        text,
        now: Date.now(),
      });

      if (currentSequence !== this.sequence) {
        return null;
      }

      this.lastOutput = output;

      this.body.speakText(output.speech);
      this.body.setEmotion(output.emotion);
      this.body.playIntent(output.intent);

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

      this.body.speakText(fallback.speech);
      this.body.setEmotion(fallback.emotion);
      this.body.playIntent(fallback.intent);

      return fallback;
    } finally {
      if (currentSequence === this.sequence) {
        this.isThinking = false;
      }
    }
  }

  interrupt(): void {
    this.sequence += 1;
    this.isThinking = false;
    this.body.stop?.();
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
