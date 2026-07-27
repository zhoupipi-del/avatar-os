import { useEffect, useState } from "react";
import {
  applyVoiceControlState,
  clampVoiceControlState,
  DEFAULT_VOICE_CONTROL_STATE,
  type VoiceControlState,
} from "./voice-control-state";
import type {
  BrowserTtsController,
  BrowserTtsStatus,
} from "./browser-tts-controller";

export interface VoiceControlOverlayProps {
  readonly tts: BrowserTtsController | null;
}

export function VoiceControlOverlay({ tts }: VoiceControlOverlayProps) {
  const [state, setState] = useState<VoiceControlState>(
    DEFAULT_VOICE_CONTROL_STATE,
  );
  const [status, setStatus] = useState<BrowserTtsStatus | null>(null);

  // 同步控件状态到 controller（下一次 speak 生效，不改动正在播放的 utterance）
  useEffect(() => {
    if (!tts) {
      return;
    }
    applyVoiceControlState(clampVoiceControlState(state), tts);
  }, [tts, state]);

  // 定期刷新 debug 状态（speaking/pending 由 WebView 异步更新）
  useEffect(() => {
    if (!tts) {
      setStatus(null);
      return;
    }
    const refresh = () => setStatus(tts.getStatus());
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => window.clearInterval(timer);
  }, [tts]);

  if (!tts) {
    return null;
  }

  const available = status?.available ?? false;

  return (
    <div className="avatar-voice-control">
      <div className="avatar-voice-control__row avatar-voice-control__head">
        <label className="avatar-voice-control__switch">
          <input
            type="checkbox"
            checked={state.enabled}
            disabled={!available}
            onChange={(event) =>
              setState((prev) => ({
                ...prev,
                enabled: event.currentTarget.checked,
              }))
            }
          />
          <span>TTS 开关</span>
        </label>
        <button
          type="button"
          className="avatar-voice-control__stop"
          disabled={!available}
          onClick={() => tts.cancel()}
        >
          停止朗读
        </button>
      </div>

      <Slider
        label="音量"
        min={0}
        max={1}
        step={0.01}
        value={state.volume}
        disabled={!available}
        onChange={(value) =>
          setState((prev) => ({ ...prev, volume: value }))
        }
      />
      <Slider
        label="语速"
        min={0.1}
        max={3}
        step={0.1}
        value={state.rate}
        disabled={!available}
        onChange={(value) => setState((prev) => ({ ...prev, rate: value }))}
      />
      <Slider
        label="音调"
        min={0}
        max={2}
        step={0.1}
        value={state.pitch}
        disabled={!available}
        onChange={(value) =>
          setState((prev) => ({ ...prev, pitch: value }))
        }
      />

      <div className="avatar-voice-control__debug">
        <div>available: {String(available)}</div>
        <div>speaking: {String(status?.speaking ?? false)}</div>
        <div>pending: {String(status?.pending ?? false)}</div>
        <div>voiceName: {status?.voiceName ?? "—"}</div>
      </div>
    </div>
  );
}

interface SliderProps {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
}: SliderProps) {
  return (
    <div className="avatar-voice-control__row">
      <label className="avatar-voice-control__slider">
        <span className="avatar-voice-control__label">
          {label} {value.toFixed(2)}
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      </label>
    </div>
  );
}
