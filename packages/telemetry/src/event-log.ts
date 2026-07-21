import { kernelEventBus } from "@avatar-os/runtime";

export enum TelemetryLevel {
  IMPORTANT = "IMPORTANT",
  BEHAVIOR = "BEHAVIOR",
  DEBUG = "DEBUG",
}

export interface TelemetryEntry {
  ts: number;
  level: TelemetryLevel;
  category: string;
  message: string;
}

/**
 * 分级遥测：仅归档 IMPORTANT + BEHAVIOR，DEBUG 仅落控制台。
 * 订阅 kernelEventBus 全量事件——视图与内核都不需要关心遥测，埋点自我驱动。
 */
export class Telemetry {
  private archived: TelemetryEntry[] = [];

  public init() {
    kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (intent) =>
      this.archive(TelemetryLevel.BEHAVIOR, "intent", `${intent.type}@${intent.intensity}`),
    );
    kernelEventBus.on("STATE_MOOD_CHANGED", (p) =>
      this.archive(TelemetryLevel.BEHAVIOR, "mood", `${p.mood}`),
    );
    kernelEventBus.on("SENSOR_MOUSE_NEAR", () => this.log(TelemetryLevel.DEBUG, "sensor", "near"));
    kernelEventBus.on("SENSOR_MOUSE_FAR", () => this.log(TelemetryLevel.DEBUG, "sensor", "far"));
  }

  public log(level: TelemetryLevel, category: string, message: string): TelemetryEntry {
    const entry: TelemetryEntry = { ts: Date.now(), level, category, message };
    if (level === TelemetryLevel.DEBUG) {
      console.debug(`[telemetry:DEBUG] ${category}: ${message}`);
    } else {
      this.archived.push(entry);
      console.log(`[telemetry:${level}] ${category}: ${message}`);
    }
    return entry;
  }

  private archive(level: TelemetryLevel, category: string, message: string) {
    this.archived.push({ ts: Date.now(), level, category, message });
    console.log(`[telemetry:${level}] ${category}: ${message}`);
  }

  public getArchive(): TelemetryEntry[] {
    return [...this.archived];
  }
}

export const telemetry = new Telemetry();
