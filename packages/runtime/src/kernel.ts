// ============================================================
// AvatarKernel — 去单例化物理内核容器 (v0.1.0-alpha Kernel Skeleton)
// ============================================================
// 设计原则：
//   - 不再依赖全局单例 kernelEventBus / behaviorVM / driveEngine。
//   - AvatarKernel 是显式实例化的聚合容器，聚合 MemoryKernel + EventBus
//     (Map 监听) + Sensor 注册 + activeBehavior + Intent 仲裁与分发。
//   - 去单例化意味着：单元测试可以独立创建沙盒内核、
//     状态重放/快照回滚成为可能、多个 Avatar（多个 Tauri 窗口）独立运行。
//
// 与冻结期 kernelEventBus 的关系：
//   - kernelEventBus 是传输层（pub/sub，已落地）。
//   - AvatarKernel 内部通过 Map<KernelEventType, cb[]> 做自有监听，
//     同时也 fire 到 kernelEventBus，保证 AvatarFSM / Avatar.tsx 持续工作。
//   - Day7 收口：Avatar.tsx 迁移至 IntentRegistry / PHYSICAL_INTENT_DISPATCH 后，
//     移除兼容桥，AvatarKernel 独掌事件路由。
// ============================================================

import type {
  PhysicalIntent,
  KernelEvent,
  IntentSource,
  LifeState,
  DrivePressures,
} from "@avatar-os/primitives";
import { makeIntent } from "@avatar-os/primitives";
import { MemoryKernel } from "@avatar-os/memory";
import { kernelEventBus } from "./event-bus";
import { DriveEngine } from "./drive-engine";
import { BehaviorVM } from "./behavior-vm";
import { registerDefaultRules } from "./behavior-rules";
import type { SensorAdapter } from "@avatar-os/sensor";

// ------- 类型 -------

export type KernelEventListener = (event: KernelEvent) => void;

export interface KernelConfig {
  sensors?: SensorAdapter[];
  memory?: MemoryKernel;
  driveTickMs?: number;
}

// ------- AvatarKernel -------

export class AvatarKernel {
  /** 事件监听器注册表 (type → {cb, id}[]) */
  private eventListeners: Map<string, { id: string; cb: KernelEventListener }[]> = new Map();
  /** 已注册的传感器适配器 */
  private sensors: Map<string, SensorAdapter> = new Map();
  /** 当前活跃的行为实例 (BehaviorVM candidate) */
  private _activeBehavior: { ruleId: string; priority: number } | null = null;

  public readonly memory: MemoryKernel;
  public readonly behaviorVM: BehaviorVM;
  public readonly driveEngine: DriveEngine;

  constructor(config?: KernelConfig) {
    this.memory = config?.memory ?? new MemoryKernel();
    this.behaviorVM = new BehaviorVM();
    this.driveEngine = new DriveEngine(); // 升舱后接受可选 Partial<LifeState>，无参即默认陪伴基线
    registerDefaultRules(this.behaviorVM);

    // 注册默认传感器
    if (config?.sensors) {
      config.sensors.forEach((s) => this.registerSensor(s));
    }
  }

  // ------- 传感器管理 -------

  public registerSensor(sensor: SensorAdapter): void {
    if (this.sensors.has(sensor.name)) {
      console.warn(`[AvatarKernel] Sensor "${sensor.name}" already registered, skipping.`);
      return;
    }
    this.sensors.set(sensor.name, sensor);
    sensor.start((event: KernelEvent) => this.dispatchKernelEvent(event));
    console.log(`[AvatarKernel] Sensor registered: ${sensor.name}`);
  }

  public unregisterSensor(name: string): void {
    const sensor = this.sensors.get(name);
    if (sensor) {
      sensor.stop();
      this.sensors.delete(name);
    }
  }

  // ------- 事件分发 -------

  /**
   * dispatchKernelEvent — 内核事件总入口。
   * 1. 先广播给内部 Map 监听器
   * 2. 再桥接到冻结期 kernelEventBus（AvatarFSM / Avatar.tsx 兼容）
   */
  public dispatchKernelEvent(event: KernelEvent): void {
    // 内部监听器
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((l) => l.cb(event));
    }

    // 冻结期兼容桥：将 KernelEvent 拆箱后 emit 到 kernelEventBus
    // 映射规则：已知事件类型直接映射，未知类型用原始 type+payload
    this.bridgeToLegacyBus(event);
  }

  /**
   * subscribe — 注册内核事件监听器（返回取消函数）
   */
  public subscribe(type: string, cb: KernelEventListener): () => void {
    const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push({ id, cb });
    return () => {
      const list = this.eventListeners.get(type);
      if (list) {
        this.eventListeners.set(type, list.filter((l) => l.id !== id));
      }
    };
  }

  // ------- Intent 仲裁与分发 -------

  /**
   * dispatchIntent — 将 PhysicalIntent 经内核仲裁后发射到渲染管线。
   * 冻结期直接 emit 到 kernelEventBus 的 PHYSICAL_INTENT_DISPATCH，
   * Day7 收口后路由到 IntentRegistry。
   */
  public dispatchIntent(intent: PhysicalIntent): void {
    this._activeBehavior = {
      ruleId: intent.type,
      priority: intent.priority,
    };
    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", intent);
  }

  /** 获取当前活跃行为 */
  public get activeBehavior(): { ruleId: string; priority: number } | null {
    return this._activeBehavior;
  }

  // ------- 生命周期 -------

  public async init(): Promise<void> {
    await this.memory.init();
    console.log("[AvatarKernel] Lifecycle initialized.");
  }

  public shutdown(): void {
    this.sensors.forEach((s) => s.stop());
    this.sensors.clear();
    this.eventListeners.clear();
    console.log("[AvatarKernel] Shutdown complete.");
  }

  // ------- 冻结期兼容桥（内部） -------

  private bridgeToLegacyBus(event: KernelEvent): void {
    // 将 KernelEvent.type 映射回 kernelEventBus 已知的 KernelEventType
    const legacyMap: Record<string, string> = {
      SENSOR_CURSOR_MOVE: "SENSOR_MOUSE_MOVE",
      SENSOR_CURSOR_NEAR: "SENSOR_MOUSE_NEAR",
      SENSOR_CURSOR_FAR: "SENSOR_MOUSE_FAR",
      SENSOR_IDLE_CHECK: "DRIVE_PRESSURE_TICK",
    };

    const legacyType = legacyMap[event.type] ?? event.type;
    kernelEventBus.emit(legacyType as any, event.payload);
  }
}
