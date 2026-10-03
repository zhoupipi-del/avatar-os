export interface BrowserTtsControllerOptions {
  readonly enabled?: boolean;
  readonly lang?: string;
  readonly rate?: number;
  readonly pitch?: number;
  readonly volume?: number;
  readonly speechSynthesis?: SpeechSynthesis | null;
  readonly utteranceCtor?: SpeechSynthesisUtteranceConstructor | null;
}

export interface BrowserTtsStatus {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly speaking: boolean;
  readonly pending: boolean;
  readonly voiceName: string | null;
  readonly lang: string;
}

type SpeechSynthesisUtteranceConstructor =
  new (text: string) => SpeechSynthesisUtterance;

export interface BrowserSpeechCallbacks {
  readonly onStart?: () => void;
  readonly onEnd?: () => void;
}

export class BrowserTtsController {
  private enabled: boolean;
  private readonly lang: string;
  private rate: number;
  private pitch: number;
  private volume: number;
  private readonly synth: SpeechSynthesis | null;
  private readonly utteranceCtor: SpeechSynthesisUtteranceConstructor | null;

  private selectedVoice: SpeechSynthesisVoice | null = null;
  private sequence = 0;
  private onCancel: (() => void) | null = null;

  constructor(options: BrowserTtsControllerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.lang = options.lang ?? "zh-CN";
    this.rate = normalizeRange(options.rate ?? 1, 0.1, 10);
    this.pitch = normalizeRange(options.pitch ?? 1, 0, 2);
    this.volume = normalizeRange(options.volume ?? 1, 0, 1);

    this.synth =
      options.speechSynthesis ??
      globalThis.window?.speechSynthesis ??
      null;

    this.utteranceCtor =
      options.utteranceCtor ??
      globalThis.window?.SpeechSynthesisUtterance ??
      null;

    this.refreshVoice();
  }

  speak(text: string, callbacks: BrowserSpeechCallbacks = {}): boolean {
    const content = text.trim();

    if (!this.enabled || !content || !this.isAvailable()) {
      return false;
    }

    this.cancel();
    const sequence = this.sequence;
    this.refreshVoice();

    const utterance = new this.utteranceCtor!(content);
    utterance.lang = this.lang;
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    utterance.volume = this.volume;
    let started = false;
    let finished = false;
    utterance.onstart = () => {
      if (sequence !== this.sequence || started || finished) return;
      started = true;
      callbacks.onStart?.();
    };
    const finish = () => {
      if (sequence !== this.sequence || finished) return;
      finished = true;
      this.onCancel = null;
      callbacks.onEnd?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    this.onCancel = () => callbacks.onEnd?.();

    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
    }

    try {
      this.synth!.speak(utterance);
      return true;
    } catch {
      // Browser TTS must never break avatar runtime.
      this.onCancel = null;
      return false;
    }
  }

  cancel(): void {
    this.sequence += 1;
    const onCancel = this.onCancel;
    this.onCancel = null;
    onCancel?.();
    if (!this.synth) {
      return;
    }

    try {
      this.synth.cancel();
    } catch {
      // no-op
    }
  }

  dispose(): void {
    this.cancel();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  setOptions(
    options: Partial<
      Pick<BrowserTtsControllerOptions, "rate" | "pitch" | "volume">
    >,
  ): void {
    if (typeof options.rate === "number") {
      this.rate = normalizeRange(options.rate, 0.1, 10);
    }
    if (typeof options.pitch === "number") {
      this.pitch = normalizeRange(options.pitch, 0, 2);
    }
    if (typeof options.volume === "number") {
      this.volume = normalizeRange(options.volume, 0, 1);
    }
  }

  /** 当前朗读参数（云端克隆声音复用同一组音量 / 语速，⚙ 里的滑杆对两种声音都生效） */
  getVoiceParams(): { readonly rate: number; readonly pitch: number; readonly volume: number } {
    return { rate: this.rate, pitch: this.pitch, volume: this.volume };
  }

  getStatus(): BrowserTtsStatus {
    return {
      available: this.isAvailable(),
      enabled: this.enabled,
      speaking: Boolean(this.synth?.speaking),
      pending: Boolean(this.synth?.pending),
      voiceName: this.selectedVoice?.name ?? null,
      lang: this.lang,
    };
  }

  private isAvailable(): boolean {
    return Boolean(this.synth && this.utteranceCtor);
  }

  private refreshVoice(): void {
    if (!this.synth) {
      this.selectedVoice = null;
      return;
    }

    let voices: SpeechSynthesisVoice[] = [];

    try {
      voices = this.synth.getVoices();
    } catch {
      voices = [];
    }

    this.selectedVoice = chooseVoice(voices, this.lang);
  }
}

export function chooseVoice(
  voices: readonly SpeechSynthesisVoice[],
  preferredLang = "zh-CN",
): SpeechSynthesisVoice | null {
  const normalizedPreferred = preferredLang.toLowerCase();

  const exact = voices.find(
    (voice) => voice.lang.toLowerCase() === normalizedPreferred,
  );

  if (exact) {
    return exact;
  }

  const chinese = voices.find((voice) =>
    voice.lang.toLowerCase().startsWith("zh"),
  );

  if (chinese) {
    return chinese;
  }

  return voices[0] ?? null;
}

function normalizeRange(
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}
