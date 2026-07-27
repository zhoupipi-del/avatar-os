import { useState } from "react";
import {
  TextVisemeExpressionDriver,
  type TextVisemeExpressionDriverStatus,
} from "./text-viseme-expression-driver";
import type { LipSyncExpressionManagerLike } from "./lip-sync-expression-writer";
import type { LipShapeProbeResult } from "./vrm-lip-shape-probe";

const DEFAULT_CAP = 0.7;
const DEFAULT_ATTACK = 50;
const DEFAULT_RELEASE = 30;

export interface LipSyncControlOverlayProps {
  readonly driver: TextVisemeExpressionDriver | null;
  readonly getManager: () => LipSyncExpressionManagerLike | null;
  readonly status?: TextVisemeExpressionDriverStatus | null;
  readonly lipProbe?: LipShapeProbeResult | null;
}

export function LipSyncControlOverlay({
  driver,
  getManager,
  status,
  lipProbe,
}: LipSyncControlOverlayProps) {
  const initial = driver?.getOptions();
  const [enabled, setEnabledState] = useState(initial?.enabled ?? true);
  const [cap, setCap] = useState(initial?.cap ?? DEFAULT_CAP);
  const [attack, setAttack] = useState(initial?.attack ?? DEFAULT_ATTACK);
  const [release, setRelease] = useState(initial?.release ?? DEFAULT_RELEASE);

  if (!driver) {
    return null;
  }

  const handleEnabledChange = (next: boolean) => {
    setEnabledState(next);
    driver.setEnabled(next, getManager());
  };

  const handleCapChange = (value: number) => {
    setCap(value);
    driver.setOptions({ cap: value });
  };

  const handleAttackChange = (value: number) => {
    setAttack(value);
    driver.setOptions({ attack: value });
  };

  const handleReleaseChange = (value: number) => {
    setRelease(value);
    driver.setOptions({ release: value });
  };

  const handleResetAll = () => {
    // cancel 同时清空 timeline + 归零 aa/ih/ou/ee/oh
    driver.cancel(getManager());
  };

  const writer = status?.writer;

  return (
    <div className="avatar-lipsync-control">
      <div className="avatar-lipsync-control__row avatar-lipsync-control__head">
        <label className="avatar-lipsync-control__switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => handleEnabledChange(event.currentTarget.checked)}
          />
          <span>LipSync 开关</span>
        </label>
        <button
          type="button"
          className="avatar-lipsync-control__reset"
          onClick={handleResetAll}
        >
          重置嘴型
        </button>
      </div>

      <Slider
        label="强度"
        min={0}
        max={1}
        step={0.01}
        value={cap}
        onChange={handleCapChange}
      />
      <Slider
        label="张嘴速度"
        min={1}
        max={200}
        step={1}
        value={attack}
        onChange={handleAttackChange}
      />
      <Slider
        label="闭嘴速度"
        min={1}
        max={200}
        step={1}
        value={release}
        onChange={handleReleaseChange}
      />

      <div className="avatar-lipsync-control__debug">
        <div>enabled: {String(status?.enabled ?? false)}</div>
        <div>active: {String(writer?.active ?? false)}</div>
        <div>probeAvailable: {String(writer?.probeAvailable ?? false)}</div>
        <div>shape: {writer?.currentShape ?? "none"}</div>
        <div>weight: {(writer?.currentWeight ?? 0).toFixed(2)}</div>
        <div>reset: {writer?.resetCount ?? 0}</div>
        <div>lastError: {writer?.lastError ?? "—"}</div>
        <div className="avatar-lipsync-control__debug-sep" />
        <div>
          Lip:{" "}
          {lipProbe
            ? lipProbe.available
              ? `available [${lipProbe.availableShapes.join(", ")}]`
              : `missing [${lipProbe.missing.join(", ")}]`
            : "probing…"}
        </div>
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
  readonly onChange: (value: number) => void;
}

function Slider({ label, min, max, step, value, onChange }: SliderProps) {
  return (
    <div className="avatar-lipsync-control__row">
      <label className="avatar-lipsync-control__slider">
        <span className="avatar-lipsync-control__label">
          {label} {value.toFixed(2)}
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      </label>
    </div>
  );
}
