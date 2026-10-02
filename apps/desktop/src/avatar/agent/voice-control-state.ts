import type { BrowserTtsController } from "./browser-tts-controller";

export interface VoiceControlState {
  readonly enabled: boolean;
  readonly rate: number;
  readonly pitch: number;
  readonly volume: number;
}

export const DEFAULT_VOICE_CONTROL_STATE: VoiceControlState = {
  enabled: true,
  rate: 1,
  pitch: 1,
  volume: 1,
};

export function clampVoiceControlState(
  state: VoiceControlState,
): VoiceControlState {
  return {
    enabled: state.enabled,
    rate: clamp(state.rate, 0.1, 10),
    pitch: clamp(state.pitch, 0, 2),
    volume: clamp(state.volume, 0, 1),
  };
}

export function applyVoiceControlState(
  state: VoiceControlState,
  tts: BrowserTtsController,
): void {
  tts.setEnabled(state.enabled);
  tts.setOptions({
    rate: state.rate,
    pitch: state.pitch,
    volume: state.volume,
  });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
