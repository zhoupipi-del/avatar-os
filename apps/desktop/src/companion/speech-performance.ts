import type { SpeakCallbacks, VoiceSource } from "./cloud-voice";

interface SpeechVoice {
  speak(text: string, callbacks: SpeakCallbacks): Promise<VoiceSource>;
  cancel(): void;
}

export interface SpeechPerformanceOptions {
  readonly voice: SpeechVoice;
  readonly onPrepare: () => void;
  readonly onStart: (text: string) => void;
  readonly onEnd: () => void;
  readonly silentDurationMs: (text: string) => number;
}

/** Own one utterance's body lifecycle, including late callbacks after cancellation. */
export class SpeechPerformance {
  private sequence = 0;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: SpeechPerformanceOptions) {}

  isActive(): boolean {
    return this.active;
  }

  speak(text: string, perform?: () => void): void {
    this.cancel();
    if (!text.trim()) return;
    const sequence = this.sequence;
    this.active = true;
    this.options.onPrepare();
    let started = false;
    const finish = () => {
      if (sequence !== this.sequence || !this.active) return;
      this.sequence += 1;
      this.active = false;
      clearTimeout(this.timer);
      this.timer = undefined;
      this.options.onEnd();
    };
    void this.options.voice
      .speak(text, {
        onStart: () => {
          if (sequence !== this.sequence || !this.active || started) return;
          started = true;
          perform?.();
          this.options.onStart(text);
        },
        onEnd: finish,
      })
      .then((source) => {
        // Muted / unavailable speech keeps the text performance for a bounded duration.
        if (source === "muted" && sequence === this.sequence && this.active) {
          this.timer = setTimeout(finish, this.options.silentDurationMs(text));
        }
      })
      .catch(finish);
  }

  cancel(): void {
    this.sequence += 1;
    clearTimeout(this.timer);
    this.timer = undefined;
    const active = this.active;
    this.active = false;
    this.options.voice.cancel();
    if (active) this.options.onEnd();
  }
}
